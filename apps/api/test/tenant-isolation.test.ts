import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createPlatformAdmin, createTenant, createUnit, registerStudent, startApp, type TenantFixture, type TestApp } from './helpers.js';

/** Acceptance criterion 21-2 «ایزوله‌سازی چندسازمانی»: tenant A never sees tenant B rows. */
describe('tenant isolation (TEN-02, RLS)', () => {
  let t: TestApp;
  let a: TenantFixture;
  let b: TenantFixture;
  let app: pg.Pool;
  let unitB: string;
  let platformToken = '';

  beforeAll(async () => {
    t = await startApp();
    const platform = await createPlatformAdmin(t);
    platformToken = platform.token;
    a = await createTenant(t, platform.token);
    b = await createTenant(t, platform.token);
    const unitA = (await createUnit(t, a, 'دانشکده الف')).id;
    unitB = (await createUnit(t, b, 'دانشکده ب')).id;
    await registerStudent(t, a, unitA);
    await registerStudent(t, b, unitB);
    app = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => {
    await app.end();
    await t.close();
  });

  const asTenant = async <T>(tenantId: string | '', fn: (c: pg.PoolClient) => Promise<T>) => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      return await fn(c);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  };

  const TENANT_TABLES = ['org_unit_types', 'org_units', 'memberships', 'membership_units', 'membership_events', 'file_objects', 'role_assignments', 'audit_logs'];

  it.each(TENANT_TABLES)('%s: rows are only visible inside their own tenant', async (table) => {
    const rows = await asTenant(a.id, (c) => c.query<{ tenant_id: string }>(`select distinct tenant_id from ${table}`));
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.every((r) => r.tenant_id === a.id)).toBe(true);
  });

  it.each(TENANT_TABLES.filter((x) => x !== 'audit_logs'))('%s: nothing is visible without a tenant context', async (table) => {
    const rows = await asTenant('', (c) => c.query(`select 1 from ${table} limit 1`));
    expect(rows.rowCount).toBe(0);
  });

  it('writes into another tenant are rejected by the database', async () => {
    await expect(
      asTenant(a.id, (c) =>
        c.query("insert into org_unit_types (tenant_id, key, name_fa) values ($1, 'hack', 'x')", [b.id]),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await asTenant(a.id, (c) => c.query("update org_units set name_fa = 'hacked' where tenant_id = $1", [b.id]));
    expect(updated.rowCount).toBe(0);
  });

  it('API: tenant A admin gets nothing from tenant B', async () => {
    await t.http.get('/v1/admin/memberships').set(as(a.adminToken, b.slug)).expect(403);
    await t.http.get(`/v1/admin/units`).set(as(a.adminToken, b.slug)).expect(403);
    const own = await t.http.get('/v1/admin/memberships').set(as(a.adminToken, a.slug)).expect(200);
    expect(own.body.items.every((m: { unitId: string }) => m.unitId !== unitB)).toBe(true);
    // a resource id from tenant B is simply not found from tenant A
    const bList = await t.http.get('/v1/admin/memberships').set(as(b.adminToken, b.slug)).expect(200);
    const bMember = bList.body.items[0].id;
    await t.http.get(`/v1/admin/memberships/${bMember}`).set(as(a.adminToken, a.slug)).expect(404);
  });

  it('unknown or missing tenant is refused', async () => {
    await t.http.get('/v1/public/units').expect(400);
    await t.http.get('/v1/public/units').set({ 'x-tenant': 'nope-nope' }).expect(404);
  });

  it('platform admin sees aggregate numbers per university; university admins cannot', async () => {
    const o = await t.http.get(`/v1/platform/tenants/${a.id}/overview`).set(as(platformToken)).expect(200);
    expect(o.body.members.byStatus.pending_review).toBe(1);
    expect(o.body.admins).toHaveLength(1);
    // aggregates only: no personal records of members
    expect(JSON.stringify(o.body)).not.toContain('علي رضايي');
    const list = await t.http.get('/v1/platform/tenants').set(as(platformToken)).expect(200);
    expect(list.body.find((x: { id: string }) => x.id === b.id).stats.pendingMembers).toBe(1);
    await t.http.get(`/v1/platform/tenants/${a.id}/overview`).set(as(a.adminToken, a.slug)).expect(403);
  });
});
