import { hash, verify } from '@node-rs/argon2';
import { AppError } from '../../common/errors/app-error.js';

// Argon2id (AUTH-07); @node-rs/argon2 defaults to Argon2id. OWASP-recommended parameters.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(stored: string | null | undefined, password: string): Promise<boolean> {
  // verify against a fixed hash when the account has none, so timing does not leak existence
  const target = stored ?? (await dummyHash);
  try {
    const ok = await verify(target, password);
    return ok && !!stored;
  } catch {
    return false;
  }
}

const dummyHash = hash('timing-equalizer-not-a-password', OPTIONS);

const COMMON = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'qwerty123', '11111111', '00000000',
  'iloveyou', 'admin123', 'abc12345', '1q2w3e4r', 'qwertyuiop', '87654321', 'p@ssw0rd', 'password123',
]);

/** Password policy (AUTH-08): minimum length (tenant-configurable) and a common-password check. */
export function assertPasswordPolicy(password: string, minLength = 8) {
  if (password.length < Math.max(minLength, 8) || password.length > 128 || COMMON.has(password.toLowerCase())) {
    throw new AppError('WEAK_PASSWORD', { minLength: Math.max(minLength, 8) });
  }
}
