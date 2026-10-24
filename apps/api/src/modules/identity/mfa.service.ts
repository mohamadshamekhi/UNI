import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';
import { hmac, randomToken } from '../../common/util/crypto.js';
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUri, verifyTotp } from '../../common/util/totp.js';
import { DbService } from '../../database/db.service.js';
import { users } from '../../database/schema.js';
import { RedisService } from '../../infra/redis.js';
import { AuditService } from '../audit/audit.service.js';
import { verifyPassword } from './password.js';

const ISSUER = 'سامانه خدمات دانشگاهی';
const PENDING_TTL = 10 * 60;
const MFA_TOKEN_TTL = 5 * 60;
const RECOVERY_CODES = 8;

interface MfaClaims {
  sub: string;
  typ: 'mfa';
  jti: string;
  /** auth method of the first factor, for the audit trail */
  via: 'password' | 'otp';
}

/** AUTH-12: TOTP second factor with one-time recovery codes. */
@Injectable()
export class MfaService {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private recoveryHash(code: string) {
    return hmac(this.env.HASH_PEPPER, `recovery:${code.replace(/[\s-]/g, '').toLowerCase()}`);
  }

  async status(userId: string) {
    const [u] = await this.db.sys.select({ enabledAt: users.totpEnabledAt, codes: users.recoveryCodeHashes }).from(users).where(eq(users.id, userId));
    return { enabled: !!u?.enabledAt, enabledAt: u?.enabledAt ?? null, recoveryCodesLeft: u?.codes.length ?? 0 };
  }

  /** Starts enrolment: the secret stays pending (encrypted, 10 min) until a code confirms it. */
  async setup(userId: string) {
    const [u] = await this.db.sys.select({ mobile: users.mobile, enabledAt: users.totpEnabledAt }).from(users).where(eq(users.id, userId));
    if (!u) throw new AppError('NOT_FOUND');
    if (u.enabledAt) throw new AppError('CONFLICT', { reason: 'already_enabled' });
    const secret = newTotpSecret();
    await this.redis.client.set(`totp:pending:${userId}`, encryptSecret(this.env.DATA_ENC_KEY, secret), 'EX', PENDING_TTL);
    return { secret, otpauthUri: otpauthUri(secret, u.mobile, ISSUER), expiresInSec: PENDING_TTL };
  }

  async enable(userId: string, code: string) {
    const pending = await this.redis.client.get(`totp:pending:${userId}`);
    if (!pending) throw new AppError('CONFLICT', { reason: 'setup_expired' });
    const secret = decryptSecret(this.env.DATA_ENC_KEY, pending);
    if (verifyTotp(secret, code) === null) throw new AppError('OTP_INVALID');
    const codes = Array.from({ length: RECOVERY_CODES }, () => randomToken(6).replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8).toLowerCase());
    await this.db.run((tx) =>
      tx
        .update(users)
        .set({ totpSecretEnc: pending, totpEnabledAt: new Date(), recoveryCodeHashes: codes.map((c) => this.recoveryHash(c)), updatedAt: new Date() })
        .where(eq(users.id, userId)),
    );
    await this.redis.client.del(`totp:pending:${userId}`);
    await this.audit.record({ action: 'auth.2fa.enabled', tenantId: null, targetType: 'user', targetId: userId });
    // shown once; only hashes are kept
    return { recoveryCodes: codes.map((c) => `${c.slice(0, 4)}-${c.slice(4)}`) };
  }

  async disable(userId: string, password: string, code: string) {
    const [u] = await this.db.sys.select().from(users).where(eq(users.id, userId));
    if (!u?.totpEnabledAt) throw new AppError('CONFLICT', { reason: 'not_enabled' });
    if (!(await verifyPassword(u.passwordHash, password))) throw new AppError('INVALID_CREDENTIALS');
    await this.checkSecondFactor(u, code);
    await this.db.run((tx) =>
      tx.update(users).set({ totpSecretEnc: null, totpEnabledAt: null, recoveryCodeHashes: [], updatedAt: new Date() }).where(eq(users.id, userId)),
    );
    await this.audit.record({ action: 'auth.2fa.disabled', tenantId: null, targetType: 'user', targetId: userId });
  }

  /** After a correct first factor: short-lived token that only the 2FA step accepts. */
  issueChallenge(userId: string, via: MfaClaims['via']) {
    const token = this.jwt.sign({ sub: userId, typ: 'mfa', jti: randomUUID(), via } satisfies MfaClaims, {
      secret: this.env.JWT_PROOF_SECRET,
      expiresIn: MFA_TOKEN_TTL,
      algorithm: 'HS256',
    });
    return { mfaRequired: true as const, mfaToken: token, expiresInSec: MFA_TOKEN_TTL };
  }

  /** Verifies the challenge + code; returns the user id. Max 5 tries per challenge. */
  async completeChallenge(mfaToken: string, code: string): Promise<{ userId: string; via: MfaClaims['via'] }> {
    let claims: MfaClaims;
    try {
      claims = this.jwt.verify<MfaClaims>(mfaToken, { secret: this.env.JWT_PROOF_SECRET, algorithms: ['HS256'] });
      if (claims.typ !== 'mfa') throw new Error('type');
    } catch {
      throw new AppError('SESSION_EXPIRED');
    }
    const tries = await this.redis.client.incr(`mfa:tries:${claims.jti}`);
    await this.redis.client.expire(`mfa:tries:${claims.jti}`, MFA_TOKEN_TTL, 'NX');
    if (tries > 5) throw new AppError('OTP_TOO_MANY_ATTEMPTS');
    if (await this.redis.client.exists(`mfa:used:${claims.jti}`)) throw new AppError('SESSION_EXPIRED');
    const [u] = await this.db.sys.select().from(users).where(eq(users.id, claims.sub));
    if (!u?.totpEnabledAt || u.status !== 'active') throw new AppError('SESSION_EXPIRED');
    await this.checkSecondFactor(u, code);
    await this.redis.client.set(`mfa:used:${claims.jti}`, '1', 'EX', MFA_TOKEN_TTL);
    return { userId: u.id, via: claims.via };
  }

  /** TOTP code (single use per time step) or a recovery code (consumed). */
  private async checkSecondFactor(u: typeof users.$inferSelect, code: string) {
    const clean = code.trim();
    if (/^\d{6}$/.test(clean)) {
      const step = verifyTotp(decryptSecret(this.env.DATA_ENC_KEY, u.totpSecretEnc!), clean);
      if (step === null) throw new AppError('OTP_INVALID');
      const fresh = await this.redis.client.set(`totp:used:${u.id}:${step}`, '1', 'EX', 120, 'NX');
      if (fresh !== 'OK') throw new AppError('OTP_INVALID');
      return;
    }
    const hash = this.recoveryHash(clean);
    if (!u.recoveryCodeHashes.includes(hash)) throw new AppError('OTP_INVALID');
    await this.db.sys
      .update(users)
      .set({ recoveryCodeHashes: u.recoveryCodeHashes.filter((h) => h !== hash) })
      .where(eq(users.id, u.id));
    await this.audit.recordDetached({ action: 'auth.2fa.recovery_code_used', tenantId: null, actorUserId: u.id, targetType: 'user', targetId: u.id });
  }
}
