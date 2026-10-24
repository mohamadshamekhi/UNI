// Creates the first platform admin (مدیر کل) from SEED_PLATFORM_ADMIN_* env vars. Idempotent.
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { normalizeMobile } from '../common/util/normalize.js';

const url = process.env.DATABASE_SYSTEM_URL;
const mobile = normalizeMobile(process.env.SEED_PLATFORM_ADMIN_MOBILE ?? '');
const password = process.env.SEED_PLATFORM_ADMIN_PASSWORD;
if (!url || !mobile || !password) throw new Error('DATABASE_SYSTEM_URL, SEED_PLATFORM_ADMIN_MOBILE and SEED_PLATFORM_ADMIN_PASSWORD are required');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (mobile, full_name, password_hash, mobile_verified_at)
     VALUES ($1, 'مدیر کل سامانه', $2, now())
     ON CONFLICT (mobile) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now() RETURNING id`,
    [mobile, passwordHash],
  );
  await client.query('INSERT INTO platform_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [rows[0]!.id]);
  console.log(`platform admin ready: ${mobile}`);
} finally {
  await client.end();
}
