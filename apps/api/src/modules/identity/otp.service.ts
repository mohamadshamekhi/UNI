import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';
import { hmac, randomOtp, safeEqual } from '../../common/util/crypto.js';
import { DbService } from '../../database/db.service.js';
import { otpChallenges, users, type OtpPurpose } from '../../database/schema.js';
import { RedisService } from '../../infra/redis.js';
import { SmsProvider } from '../../infra/sms.js';

export const OTP_TTL_SEC = 150;
export const OTP_RESEND_GAP_SEC = 60;
export const OTP_MAX_ATTEMPTS = 5;

/** Purposes that only make sense for an existing account; SMS is skipped silently otherwise. */
const ACCOUNT_PURPOSES: OtpPurpose[] = ['login', 'reset_password'];

/**
 * OTP challenges (AUTH-01/02). All writes use the system pool so attempt counters persist even
 * when the surrounding request fails and its transaction is rolled back.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly sms: SmsProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private hash(challengeId: string, code: string) {
    return hmac(this.env.HASH_PEPPER, `otp:${challengeId}:${code}`);
  }

  async request(mobile: string, purpose: OtpPurpose, ip: string | undefined, tenantId?: string) {
    await this.redis.hit(`otp:mobile:${mobile}`, 5, 3600);
    if (ip) await this.redis.hit(`otp:ip:${ip}`, this.env.OTP_IP_LIMIT_PER_HOUR, 3600);
    if (tenantId) await this.redis.hit(`otp:tenant:${tenantId}`, 2000, 3600);

    const gapKey = `otp:gap:${purpose}:${mobile}`;
    if ((await this.redis.client.set(gapKey, '1', 'EX', OTP_RESEND_GAP_SEC, 'NX')) !== 'OK') {
      throw new AppError('OTP_RESEND_TOO_SOON', { retryAfterSec: Math.max(await this.redis.client.ttl(gapKey), 1) });
    }

    const response = { expiresInSec: OTP_TTL_SEC, resendAfterSec: OTP_RESEND_GAP_SEC };

    if (ACCOUNT_PURPOSES.includes(purpose)) {
      const [user] = await this.db.sys.select({ id: users.id, status: users.status }).from(users).where(eq(users.mobile, mobile));
      // same response either way: never reveal whether the account exists (AUTH-11)
      if (!user || user.status !== 'active') return response;
    }

    const code = randomOtp();
    await this.db.sys.transaction(async (tx) => {
      // a new code invalidates earlier ones for the same purpose
      await tx
        .update(otpChallenges)
        .set({ consumedAt: new Date() })
        .where(and(eq(otpChallenges.mobile, mobile), eq(otpChallenges.purpose, purpose), isNull(otpChallenges.consumedAt)));
      const [row] = await tx
        .insert(otpChallenges)
        .values({
          mobile,
          purpose,
          codeHash: 'pending',
          maxAttempts: OTP_MAX_ATTEMPTS,
          expiresAt: new Date(Date.now() + OTP_TTL_SEC * 1000),
          createdIp: ip,
        })
        .returning({ id: otpChallenges.id });
      await tx.update(otpChallenges).set({ codeHash: this.hash(row!.id, code) }).where(eq(otpChallenges.id, row!.id));
    });

    await this.sms.send({ to: mobile, text: `کد تأیید شما: ${code}\nاین کد را در اختیار دیگران قرار ندهید.`, tenantId });
    return response;
  }

  /** Verifies and consumes the latest code. Throws OTP_INVALID / OTP_TOO_MANY_ATTEMPTS. */
  async verify(mobile: string, purpose: OtpPurpose, code: string): Promise<void> {
    const [challenge] = await this.db.sys
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.mobile, mobile),
          eq(otpChallenges.purpose, purpose),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    if (!challenge) throw new AppError('OTP_INVALID');

    const [counted] = await this.db.sys
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(and(eq(otpChallenges.id, challenge.id), lt(otpChallenges.attempts, otpChallenges.maxAttempts)))
      .returning({ attempts: otpChallenges.attempts });
    if (!counted) throw new AppError('OTP_TOO_MANY_ATTEMPTS');

    if (!safeEqual(this.hash(challenge.id, code), challenge.codeHash)) {
      throw new AppError(counted.attempts >= challenge.maxAttempts ? 'OTP_TOO_MANY_ATTEMPTS' : 'OTP_INVALID', {
        attemptsLeft: Math.max(challenge.maxAttempts - counted.attempts, 0),
      });
    }

    const [consumed] = await this.db.sys
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(and(eq(otpChallenges.id, challenge.id), isNull(otpChallenges.consumedAt)))
      .returning({ id: otpChallenges.id });
    if (!consumed) throw new AppError('OTP_INVALID'); // lost a race with a parallel verify
  }
}
