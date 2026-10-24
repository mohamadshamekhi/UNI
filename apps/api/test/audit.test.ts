import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createPlatformAdmin, createTenant, createUnit, startApp, type TenantFixture, type TestApp } from './helpers.js';

describe('audit trail (AUD-02/04/05)', () => {
  let t: TestApp;
  let tf: TenantFixture;

  beforeAll(async () => {
    t = await startApp();
    const platform = await createPlatformAdmin(t);
    tf = await createTenant(t, platform.token);
    await createUnit(t, tf, 'دانشکده ادبیات');
  });
  afterAll(() => t.close());

  it('records sensitive actions with actor and request id', async () => {
    const res = await t.http.get('/v1/admin/audit?action=unit.created').set(as(tf.adminToken, tf.slug)).expect(200);
    expect(res.body[0]).toMatchObject({ action: 'unit.created', actorType: 'user', result: 'success' });
    expect(res.body[0].requestId).toBeTruthy();
    expect(res.body[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['uni_app', process.env.DATABASE_URL!],
    ['uni_system', process.env.DATABASE_SYSTEM_URL!],
  ])('%s cannot update or delete audit rows', async (_role, url) => {
    const pool = new pg.Pool({ connectionString: url });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("select set_config('app.tenant_id', $1, true)", [tf.id]);
      await expect(c.query("update audit_logs set action = 'x' where tenant_id = $1", [tf.id])).rejects.toThrow(/permission denied|append-only/);
      await c.query('ROLLBACK');
      await expect(c.query('delete from audit_logs where tenant_id = $1', [tf.id])).rejects.toThrow(/permission denied|append-only/);
    } finally {
      c.release();
      await pool.end();
    }
  });

  it('hash chain is intact, and tampering is detected', async () => {
    const ok = await t.http.get('/v1/admin/audit/verify').set(as(tf.adminToken, tf.slug)).expect(200);
    expect(ok.body.intact).toBe(true);

    // simulate a DBA editing history directly
    const owner = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
    await owner.connect();
    await owner.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable');
    const { rows } = await owner.query<{ id: string }>("update audit_logs set reason = 'edited' where id = (select id from audit_logs where tenant_id = $1 order by seq limit 1 offset 1) returning id", [tf.id]);
    await owner.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable');
    await owner.end();

    const broken = await t.http.get('/v1/admin/audit/verify').set(as(tf.adminToken, tf.slug)).expect(200);
    expect(broken.body.intact).toBe(false);
    expect(broken.body.broken.id).toBe(rows[0]!.id);
  });
});
