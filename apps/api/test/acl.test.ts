import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createPlatformAdmin, createTenant, createUnit, login, registerStudent, setPasswordViaReset, nextMobile, startApp, type TenantFixture, type TestApp } from './helpers.js';

describe('scoped RBAC (ACL-01..12, section 5 decision path)', () => {
  let t: TestApp;
  let tf: TenantFixture;
  let engineering: string;
  let department: string;
  let science: string;
  let expertToken: string;
  let expertMembership: string;
  let roles: { id: string; key: string }[];

  beforeAll(async () => {
    t = await startApp();
    const platform = await createPlatformAdmin(t);
    tf = await createTenant(t, platform.token);
    engineering = (await createUnit(t, tf, 'دانشکده مهندسی')).id;
    science = (await createUnit(t, tf, 'دانشکده علوم')).id;
    const types = (await t.http.get('/v1/admin/unit-types').set(as(tf.adminToken, tf.slug))).body as { id: string; key: string }[];
    department = (await createUnit(t, tf, 'گروه کامپیوتر', engineering, types.find((x) => x.key === 'department')!.id)).id;
    roles = (await t.http.get('/v1/admin/roles').set(as(tf.adminToken, tf.slug)).expect(200)).body;

    // an expert of the engineering faculty subtree, invited by the admin
    const mobile = nextMobile();
    const inv = await t.http
      .post('/v1/admin/memberships/invite')
      .set(as(tf.adminToken, tf.slug))
      .send({ kind: 'staff', fullName: 'کارشناس مهندسی', mobile, unitId: engineering })
      .expect(201);
    expertMembership = inv.body.membershipId;
    await t.http
      .post('/v1/admin/role-assignments')
      .set(as(tf.adminToken, tf.slug))
      .send({ membershipId: expertMembership, roleId: roles.find((r) => r.key === 'expert')!.id, scopeType: 'unit_tree', scopeId: engineering })
      .expect(201);
    await setPasswordViaReset(t, mobile, 'Expert#Pass123');
    expertToken = await login(t, mobile, 'Expert#Pass123');
  });
  afterAll(() => t.close());

  it('unit_tree scope covers sub-units but not sibling faculties', async () => {
    const inDept = await registerStudent(t, tf, department);
    const inScience = await registerStudent(t, tf, science);

    const queue = await t.http.get('/v1/admin/memberships?status=pending_review').set(as(expertToken, tf.slug)).expect(200);
    const ids = queue.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(inDept.membershipId);
    expect(ids).not.toContain(inScience.membershipId);

    await t.http.get(`/v1/admin/memberships/${inScience.membershipId}`).set(as(expertToken, tf.slug)).expect(403);
    await t.http.post(`/v1/admin/memberships/${inScience.membershipId}/approve`).set(as(expertToken, tf.slug)).send({}).expect(403);
    await t.http.post(`/v1/admin/memberships/${inDept.membershipId}/approve`).set(as(expertToken, tf.slug)).send({}).expect(200);
  });

  it('expert cannot manage roles, and denials are audited', async () => {
    const res = await t.http.get('/v1/admin/roles').set(as(expertToken, tf.slug)).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const audit = await t.http.get('/v1/admin/audit?action=acl.denied').set(as(tf.adminToken, tf.slug)).expect(200);
    expect(audit.body.length).toBeGreaterThan(0);
  });

  it('expired assignments grant nothing (ACL-08)', async () => {
    const s = await registerStudent(t, tf, science);
    await t.http.post(`/v1/admin/memberships/${s.membershipId}/approve`).set(as(tf.adminToken, tf.slug)).send({}).expect(200);
    const token = await login(t, s.mobile, s.password);
    const a = await t.http
      .post('/v1/admin/role-assignments')
      .set(as(tf.adminToken, tf.slug))
      .send({ membershipId: s.membershipId, roleId: roles.find((r) => r.key === 'news_editor')!.id, scopeType: 'tenant', validFrom: new Date(Date.now() - 2 * 86400_000), validTo: new Date(Date.now() + 3600_000) })
      .expect(201);
    expect(Object.keys((await t.http.get('/v1/me/permissions').set(as(token, tf.slug))).body)).toContain('news.publish');

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_SYSTEM_URL });
    await pool.query("update role_assignments set valid_to = now() - interval '1 minute' where id = $1", [a.body.id]);
    await pool.end();
    expect(Object.keys((await t.http.get('/v1/me/permissions').set(as(token, tf.slug))).body)).not.toContain('news.publish');
  });

  it('custom roles only from base permissions; platform permissions are refused (ACL-02)', async () => {
    const bad = await t.http
      .post('/v1/admin/roles')
      .set(as(tf.adminToken, tf.slug))
      .send({ key: 'super', nameFa: 'ابرکاربر', permissions: ['tenant.manage'] })
      .expect(400);
    expect(bad.body.error.code).toBe('ROLE_PERMISSION_INVALID');
    const ok = await t.http
      .post('/v1/admin/roles')
      .set(as(tf.adminToken, tf.slug))
      .send({ key: 'association_publisher', nameFa: 'مسئول انجمن', permissions: ['news.create', 'news.view'] })
      .expect(201);
    const impact = await t.http.get(`/v1/admin/roles/${ok.body.id}/impact`).set(as(tf.adminToken, tf.slug)).expect(200);
    expect(impact.body).toEqual({ activeAssignments: 0, affectedMembers: 0 });
    const upd = await t.http.patch(`/v1/admin/roles/${ok.body.id}`).set(as(tf.adminToken, tf.slug)).send({ permissions: ['news.view'] }).expect(200);
    expect(upd.body.permissions).toEqual(['news.view']);
    const trail = await t.http.get(`/v1/admin/audit?targetId=${ok.body.id}&action=role.permission.changed`).set(as(tf.adminToken, tf.slug)).expect(200);
    expect(trail.body[0].before.permissions).toEqual(expect.arrayContaining(['news.create']));
  });

  it('suspension blocks the tenant for that member only (ACL-04, ACL-10)', async () => {
    const s = await registerStudent(t, tf, science);
    await t.http.post(`/v1/admin/memberships/${s.membershipId}/approve`).set(as(tf.adminToken, tf.slug)).send({}).expect(200);
    const token = await login(t, s.mobile, s.password);
    await t.http.get('/v1/me/permissions').set(as(token, tf.slug)).expect(200);
    await t.http.post(`/v1/admin/memberships/${s.membershipId}/suspend`).set(as(tf.adminToken, tf.slug)).send({ reason: 'بررسی انضباطی' }).expect(200);
    const blocked = await t.http.get('/v1/me/permissions').set(as(token, tf.slug)).expect(403);
    expect(blocked.body.error.code).toBe('MEMBERSHIP_REQUIRED');
    // account itself still works (other tenants unaffected)
    await t.http.get('/v1/me').set(as(token)).expect(200);
    await t.http.post(`/v1/admin/memberships/${s.membershipId}/reactivate`).set(as(tf.adminToken, tf.slug)).send({ reason: 'رفع' }).expect(200);
    await t.http.get('/v1/me/permissions').set(as(token, tf.slug)).expect(200);
  });

  it('unit tree: top level must be faculty-level, moving rewrites paths, archive is guarded', async () => {
    const types = (await t.http.get('/v1/admin/unit-types').set(as(tf.adminToken, tf.slug))).body as { id: string; key: string }[];
    const dept = types.find((x) => x.key === 'department')!.id;
    const top = await t.http.post('/v1/admin/units').set(as(tf.adminToken, tf.slug)).send({ nameFa: 'گروه بی‌والد', typeId: dept }).expect(400);
    expect(top.body.error.code).toBe('UNIT_INVALID');
    await t.http.post(`/v1/admin/units/${department}/move`).set(as(tf.adminToken, tf.slug)).send({ parentId: science, reason: 'بازساختاردهی' }).expect(200);
    const tree = (await t.http.get('/v1/admin/units').set(as(tf.adminToken, tf.slug)).expect(200)).body as { id: string; children: { id: string }[] }[];
    expect(tree.find((n) => n.id === science)!.children.map((c) => c.id)).toContain(department);
    await t.http.post(`/v1/admin/units/${science}/move`).set(as(tf.adminToken, tf.slug)).send({ parentId: department, reason: 'cycle' }).expect(400);
    await t.http.post(`/v1/admin/units/${science}/archive`).set(as(tf.adminToken, tf.slug)).send({ reason: 'x' }).expect(409);
  });
});
