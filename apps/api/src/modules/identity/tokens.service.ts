import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';
import { RedisService } from '../../infra/redis.js';
import type { OtpPurpose } from '../../database/schema.js';

export interface AccessClaims {
  sub: string;
  sid: string;
  typ: 'access';
}

export interface ProofClaims {
  sub: string; // E.164 mobile
  typ: 'mobile_proof';
  pur: OtpPurpose;
  jti: string;
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  signAccess(userId: string, sessionId: string): string {
    return this.jwt.sign({ sub: userId, sid: sessionId, typ: 'access' } satisfies AccessClaims, {
      secret: this.env.JWT_ACCESS_SECRET,
      expiresIn: this.env.ACCESS_TOKEN_TTL_SEC,
      algorithm: 'HS256',
    });
  }

  verifyAccess(token: string): AccessClaims {
    try {
      const claims = this.jwt.verify<AccessClaims>(token, { secret: this.env.JWT_ACCESS_SECRET, algorithms: ['HS256'] });
      if (claims.typ !== 'access') throw new Error('wrong type');
      return claims;
    } catch {
      throw new AppError('UNAUTHENTICATED');
    }
  }

  /** Proof that the caller controls `mobile` (result of a successful OTP verification). */
  signProof(mobile: string, purpose: OtpPurpose, ttlSec = 20 * 60): string {
    return this.jwt.sign({ sub: mobile, typ: 'mobile_proof', pur: purpose, jti: randomUUID() } satisfies ProofClaims, {
      secret: this.env.JWT_PROOF_SECRET,
      expiresIn: ttlSec,
      algorithm: 'HS256',
    });
  }

  verifyProof(token: string | undefined, purposes: OtpPurpose[]): ProofClaims {
    if (!token) throw new AppError('PROOF_INVALID');
    try {
      const claims = this.jwt.verify<ProofClaims>(token, { secret: this.env.JWT_PROOF_SECRET, algorithms: ['HS256'] });
      if (claims.typ !== 'mobile_proof' || !purposes.includes(claims.pur)) throw new Error('wrong purpose');
      return claims;
    } catch {
      throw new AppError('PROOF_INVALID');
    }
  }

  /** Marks a proof as used; returns false when it was already consumed. */
  async consumeProof(claims: ProofClaims): Promise<boolean> {
    const res = await this.redis.client.set(`proof:used:${claims.jti}`, '1', 'EX', 3600, 'NX');
    return res === 'OK';
  }

  async revokeAccess(sessionId: string) {
    await this.redis.client.set(`revoked:sid:${sessionId}`, '1', 'EX', this.env.ACCESS_TOKEN_TTL_SEC + 60);
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.client.exists(`revoked:sid:${sessionId}`)) === 1;
  }
}
