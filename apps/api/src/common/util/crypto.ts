import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const sha256 = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');

/** Keyed hash for lookup-only identifiers (national id, OTP codes) — never reversible. */
export const hmac = (pepper: string, input: string) => createHmac('sha256', pepper).update(input).digest('hex');

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Uniform 6-digit code from a CSPRNG (AUTH-01). */
export const randomOtp = () => randomInt(0, 1_000_000).toString().padStart(6, '0');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
