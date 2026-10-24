import { Redis } from 'ioredis';
import pg from 'pg';
import { migrate } from '../src/database/migrate.js';

const OWNER = 'postgres://uni_owner:uni_owner_dev@localhost:55432/uni_test';

/** Fresh schema per run, migrated exactly like production. */
export default async function setup() {
  const client = new pg.Client({ connectionString: OWNER });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();
  await migrate(OWNER, () => {});
  const redis = new Redis('redis://localhost:56379/15');
  await redis.flushdb();
  await redis.quit();
}
