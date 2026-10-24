import { z } from 'zod';

const secret = z.string().min(32);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default(''),
  TENANT_BASE_DOMAIN: z.string().default('uni.localhost'),

  DATABASE_URL: z.string().url(),
  DATABASE_SYSTEM_URL: z.string().url(),
  DATABASE_OWNER_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: secret,
  JWT_PROOF_SECRET: secret,
  FILE_TOKEN_SECRET: secret,
  HASH_PEPPER: secret,
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_BUCKET: z.string(),
  FILE_SCAN_MODE: z.enum(['clamav', 'skip']).default('clamav'),
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().default(3310),

  SMS_PROVIDER: z.enum(['console', 'memory']).default('console'),
  /** Abuse limits per client IP (AUTH-02); raise behind NAT-heavy campus networks. */
  OTP_IP_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(30),
  LOGIN_IP_LIMIT_PER_15MIN: z.coerce.number().int().positive().default(50),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.FILE_SCAN_MODE === 'skip') {
    throw new Error('FILE_SCAN_MODE=skip is not allowed in production (FIL-04)');
  }
  cached = parsed.data;
  return cached;
}

export const ENV = Symbol('ENV');
