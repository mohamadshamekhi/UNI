import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env.js';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { randomToken, safeEqual, sha256 } from '../../common/util/crypto.js';
import { normalizeEmail, normalizeMobile } from '../../common/util/normalize.js';
import { DbService } from '../../database/db.service.js';
import { sessions, users } from '../../database/schema.js';
import { RedisService } from '../../infra/redis.js';
import { SmsProvider } from '../../infra/sms.js';
import { AuditService } from '../audit/audit.service.js';
import { MfaService } from './mfa.service.js';
import { OtpService } from './otp.service.js';
import { assertPasswordPolicy, hashPassword, verifyPassword } from './password.js';
import { TokensService } from './tokens.service.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresInSec: number;
  sessionId: string;
}

export type LoginResult = TokenPair | ReturnType<MfaService['issueChallenge']>;

const LOCK_PER_IP = { failures: 5, windowSec: 15 * 60 };
const LOCK_GLOBAL = { failures: 20, windowSec: 15 * 60 };
/** A refresh token replayed this soon after rotation is treated as a client race, not theft. */
const REFRESH_RACE_GRACE_MS = 20_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly tokens: TokensService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    private readonly sms: SmsProvider,
    private readonly mfa: MfaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async findByIdentifier(identifier: string) {
    const mobile = normalizeMobile(identifier);
    const where = mobile ? eq(users.mobile, mobile) : eq(users.email, normalizeEmail(identifier));
    const [user] = await this.db.sys.select().from(users).where(where).limit(1);
    return user;
  }

  /**
   * Lockout (AUTH-09) is keyed per account+IP so an attacker elsewhere cannot lock the owner out;
   * a higher account-wide threshold still stops distributed guessing.
   */
  private async assertNotLocked(userId: string, ip: string) {
    const [perIp, global] = await this.redis.client.mget(`lock:login:${userId}:${ip}`, `lock:login:${userId}`);
    if (perIp || global) throw new AppError('ACCOUNT_LOCKED');
  }

  private async registerFailure(user: { id: string; mobile: string }, ip: string) {
    const r = this.redis.client;
    const ipKey = `fail:login:${user.id}:${ip}`;
    const globalKey = `fail:login:${user.id}`;
    const [[, ipCount], , [, globalCount]] = (await r
      .multi()
      .incr(ipKey)
      .expire(ipKey, LOCK_PER_IP.windowSec, 'NX')
      .incr(globalKey)
      .expire(globalKey, LOCK_GLOBAL.windowSec, 'NX')
      .exec()) as [[null, number], unknown, [null, number], unknown];
    if (ipCount === LOCK_PER_IP.failures) await r.set(`lock:login:${user.id}:${ip}`, '1', 'EX', LOCK_PER_IP.windowSec);
    if (globalCount === LOCK_GLOBAL.failures) {
      await r.set(`lock:login:${user.id}`, '1', 'EX', LOCK_GLOBAL.windowSec);
      await this.sms.send({
        to: user.mobile,
        text: 'به دلیل تلاش‌های ناموفق متعدد، ورود به حساب شما موقتاً مسدود شد. اگر این تلاش‌ها از طرف شما نبوده، رمز عبور را تغییر دهید.',
      });
    }
  }

  async loginWithPassword(identifier: string, password: string): Promise<LoginResult> {
    const ctx = requestContext.get();
    const ip = ctx.ip ?? 'unknown';
    await this.redis.hit(`login:ip:${ip}`, this.env.LOGIN_IP_LIMIT_PER_15MIN, 15 * 60);
    const user = await this.findByIdentifier(identifier);
    if (user) await this.assertNotLocked(user.id, ip);

    const ok = await verifyPassword(user?.passwordHash, password);
    if (!user || !ok) {
      if (user) await this.registerFailure(user, ip);
      await this.audit.recordDetached({
        action: 'auth.login.failed',
        result: 'denied',
        tenantId: null,
        actorUserId: user?.id ?? null,
        targetType: 'user',
        targetId: user?.id,
      });
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (user.status !== 'active') throw new AppError('ACCOUNT_DISABLED');
    await this.redis.client.del(`fail:login:${user.id}:${ip}`);
    if (user.totpEnabledAt) return this.mfa.issueChallenge(user.id, 'password');
    return this.startSession(user.id, 'auth.login.password');
  }

  async loginWithOtp(mobileInput: string, code: string): Promise<LoginResult> {
    const mobile = normalizeMobile(mobileInput);
    if (!mobile) throw new AppError('OTP_INVALID');
    await this.otp.verify(mobile, 'login', code);
    const [user] = await this.db.sys.select().from(users).where(eq(users.mobile, mobile)).limit(1);
    if (!user) throw new AppError('OTP_INVALID');
    if (user.status !== 'active') throw new AppError('ACCOUNT_DISABLED');
    if (user.totpEnabledAt) return this.mfa.issueChallenge(user.id, 'otp');
    return this.startSession(user.id, 'auth.login.otp');
  }

  /** Second step for accounts with TOTP enabled (AUTH-12). */
  async loginWithSecondFactor(mfaToken: string, code: string): Promise<TokenPair> {
    const { userId, via } = await this.mfa.completeChallenge(mfaToken, code);
    return this.startSession(userId, `auth.login.${via}.2fa`);
  }

  async startSession(userId: string, auditAction: string): Promise<TokenPair> {
    const ctx = requestContext.get();
    const secret = randomToken();
    const [session] = await this.db.run((tx) =>
      tx
        .insert(sessions)
        .values({
          userId,
          refreshHash: sha256(secret),
          userAgent: ctx.userAgent?.slice(0, 400),
          ip: ctx.ip,
          expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86400_000),
        })
        .returning({ id: sessions.id }),
    );
    await this.audit.record({ action: auditAction, tenantId: null, actorUserId: userId, targetType: 'session', targetId: session!.id });
    return this.pair(userId, session!.id, secret);
  }

  private pair(userId: string, sessionId: string, secret: string): TokenPair {
    return {
      accessToken: this.tokens.signAccess(userId, sessionId),
      refreshToken: `${sessionId}.${secret}`,
      accessExpiresInSec: this.env.ACCESS_TOKEN_TTL_SEC,
      sessionId,
    };
  }

  /** Rotating refresh tokens with reuse detection (AUTH-10). */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const [sessionId, secret] = refreshToken.split('.');
    if (!sessionId || !secret || !/^[0-9a-f-]{36}$/.test(sessionId)) throw new AppError('SESSION_EXPIRED');
    const [session] = await this.db.sys.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw new AppError('SESSION_EXPIRED');

    const presented = sha256(secret);
    if (session.prevRefreshHash && safeEqual(presented, session.prevRefreshHash)) {
      if (Date.now() - session.lastUsedAt.getTime() > REFRESH_RACE_GRACE_MS) {
        await this.revokeSessions([session.id], 'refresh_token_reuse');
        await this.audit.recordDetached({
          action: 'auth.refresh.reuse_detected',
          result: 'denied',
          tenantId: null,
          actorUserId: session.userId,
          targetType: 'session',
          targetId: session.id,
        });
      }
      throw new AppError('SESSION_EXPIRED');
    }
    if (!safeEqual(presented, session.refreshHash)) throw new AppError('SESSION_EXPIRED');

    const [user] = await this.db.sys.select({ status: users.status }).from(users).where(eq(users.id, session.userId));
    if (user?.status !== 'active') throw new AppError('ACCOUNT_DISABLED');

    const next = randomToken();
    const [rotated] = await this.db.sys
      .update(sessions)
      .set({ refreshHash: sha256(next), prevRefreshHash: session.refreshHash, lastUsedAt: new Date() })
      .where(and(eq(sessions.id, session.id), eq(sessions.refreshHash, session.refreshHash), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (!rotated) throw new AppError('SESSION_EXPIRED');
    return this.pair(session.userId, session.id, next);
  }

  /** Revocation commits independently of the request transaction. */
  async revokeSessions(ids: string[], reason: string) {
    for (const id of ids) {
      await this.db.sys
        .update(sessions)
        .set({ revokedAt: new Date(), revokeReason: reason })
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
      await this.tokens.revokeAccess(id);
    }
  }

  async logout(sessionId: string) {
    await this.revokeSessions([sessionId], 'logout');
    await this.audit.record({ action: 'auth.logout', tenantId: null, targetType: 'session', targetId: sessionId });
  }

  async logoutAll(userId: string, exceptSessionId?: string) {
    const active = await this.db.sys
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined,
        ),
      );
    await this.revokeSessions(
      active.map((s) => s.id),
      'logout_all',
    );
    await this.audit.record({ action: 'auth.logout_all', tenantId: null, targetType: 'user', targetId: userId });
    return active.length;
  }

  async listSessions(userId: string, currentSessionId?: string) {
    const rows = await this.db.sys
      .select({
        id: sessions.id,
        userAgent: sessions.userAgent,
        ip: sessions.ip,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastUsedAt));
    return rows.map((r) => ({ ...r, current: r.id === currentSessionId }));
  }

  async revokeOwnSession(userId: string, sessionId: string) {
    const [s] = await this.db.sys
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
    if (!s) throw new AppError('NOT_FOUND');
    await this.revokeSessions([s.id], 'user_revoked');
    await this.audit.record({ action: 'auth.session.revoked', tenantId: null, targetType: 'session', targetId: s.id });
  }

  /** Password reset with an OTP proof (AUTH-11); revokes every session afterwards. */
  async resetPassword(proofToken: string, newPassword: string) {
    const proof = this.tokens.verifyProof(proofToken, ['reset_password']);
    if (!(await this.tokens.consumeProof(proof))) throw new AppError('PROOF_INVALID');
    assertPasswordPolicy(newPassword);
    const [user] = await this.db.sys.select({ id: users.id }).from(users).where(eq(users.mobile, proof.sub));
    if (!user) throw new AppError('PROOF_INVALID');
    const passwordHash = await hashPassword(newPassword);
    await this.db.run((tx) => tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id)));
    await this.logoutAll(user.id);
    await this.audit.record({ action: 'auth.password.reset', tenantId: null, actorUserId: user.id, targetType: 'user', targetId: user.id });
  }

  async changePassword(userId: string, current: string, next: string, sessionId?: string) {
    const [user] = await this.db.sys.select().from(users).where(eq(users.id, userId));
    if (!user || !(await verifyPassword(user.passwordHash, current))) throw new AppError('INVALID_CREDENTIALS');
    assertPasswordPolicy(next);
    const passwordHash = await hashPassword(next);
    await this.db.run((tx) => tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId)));
    await this.logoutAll(userId, sessionId);
    await this.audit.record({ action: 'auth.password.changed', tenantId: null, targetType: 'user', targetId: userId });
  }
}
