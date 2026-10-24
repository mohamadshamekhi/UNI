import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createPlatformAdmin, createTenant, createUnit, login, registerStudent, startApp, type TenantFixture, type TestApp } from './helpers.js';

describe('student registration → review → membership (section 6, scenario A)', () => {
  let t: TestApp;
  let tf: TenantFixture;
  let facultyId: string;

  beforeAll(async () => {
    t = await startApp();
    const platform = await createPlatformAdmin(t);
    tf = await createTenant(t, platform.token);
    facultyId = (await createUnit(t, tf, 'دانشکده مهندسی')).id;
  });
  afterAll(() => t.close());

  it('registers with OTP proof, then the reviewer approves and the student role activates', async () => {
    const s = await registerStudent(t, tf, facultyId);

    // OTP ≠ membership: the account can log in but holds no permissions yet (AUTH-15)
    const studentToken = await login(t, s.mobile, s.password);
    const pending = await t.http.get('/v1/me/membership').set(as(studentToken, tf.slug)).expect(200);
    expect(pending.body.status).toBe('pending_review');
    await t.http.get('/v1/me/permissions').set(as(studentToken, tf.slug)).expect(403);

    const queue = await t.http.get('/v1/admin/memberships?status=pending_review').set(as(tf.adminToken, tf.slug)).expect(200);
    expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(s.membershipId);
    // Persian normalisation on write (UX-03): Arabic ي → Persian ی
    expect(queue.body.items.find((i: { id: string }) => i.id === s.membershipId).fullName).toBe('علی رضایی');

    const detail = await t.http.get(`/v1/admin/memberships/${s.membershipId}`).set(as(tf.adminToken, tf.slug)).expect(200);
    expect(detail.body.documents).toHaveLength(1);

    // reviewer can fetch the confidential document through a single-use link (FIL-05/06)
    const link = await t.http.post(`/v1/files/${s.fileId}/download-link`).set(as(tf.adminToken, tf.slug)).expect(201);
    const dl = await t.http.get(link.body.url).expect(200);
    expect(dl.headers['content-type']).toBe('image/png');
    await t.http.get(link.body.url).expect(403); // single use

    await t.http.post(`/v1/admin/memberships/${s.membershipId}/approve`).set(as(tf.adminToken, tf.slug)).send({}).expect(200);
    const perms = await t.http.get('/v1/me/permissions').set(as(studentToken, tf.slug)).expect(200);
    expect(Object.keys(perms.body)).toEqual(expect.arrayContaining(['case.create', 'paper.submit']));
    expect(perms.body['membership.approve']).toBeUndefined();

    // decision SMS goes through the outbox (no reason text in the SMS, NTF-07)
    // other test files leave events behind; drain every batch
    while ((await t.outbox.drain()) > 0);
    const sms = t.sms.sent.filter((m) => m.to === `+98${s.mobile.slice(1)}`).at(-1);
    expect(sms?.text).toContain('تأیید شد');
  });

  it('revision loop: only requested fields are editable, then resubmission returns to the queue', async () => {
    const s = await registerStudent(t, tf, facultyId);
    await t.http
      .post(`/v1/admin/memberships/${s.membershipId}/request-revision`)
      .set(as(tf.adminToken, tf.slug))
      .send({ reason: 'شماره دانشجویی ناخواناست', fields: ['memberNo'], deadlineDays: 3, internalNote: 'check registry' })
      .expect(200);

    const token = await login(t, s.mobile, s.password);
    const mine = await t.http.get('/v1/me/membership').set(as(token, tf.slug)).expect(200);
    expect(mine.body.status).toBe('needs_revision');
    expect(mine.body.revisionRequest.fields).toEqual(['memberNo']);
    // internal notes never reach the applicant (THS-08 / AUD-03 pattern)
    expect(JSON.stringify(mine.body)).not.toContain('check registry');

    await t.http.patch('/v1/me/membership').set(as(token, tf.slug)).send({ fullName: 'نام دیگر' }).expect(400);
    const ok = await t.http.patch('/v1/me/membership').set(as(token, tf.slug)).send({ memberNo: '۴۰۱۱۲۳۴۵' }).expect(200);
    expect(ok.body.status).toBe('pending_review');
  });

  it('rejects duplicate accounts and duplicate member numbers (AUTH-04/05)', async () => {
    const s = await registerStudent(t, tf, facultyId, { memberNo: 'dup-1' });
    expect(s.membershipId).toBeTruthy();
    // same member number inside the same tenant is refused
    await expect(registerStudent(t, tf, facultyId, { memberNo: 'dup-1' })).rejects.toThrow(/409/);
  });

  it('a reviewer cannot decide on their own request (separation of duties)', async () => {
    const s = await registerStudent(t, tf, facultyId);
    const token = await login(t, s.mobile, s.password);
    // even with an approve role in scope, the applicant can't approve themselves
    const roles = await t.http.get('/v1/admin/roles').set(as(tf.adminToken, tf.slug)).expect(200);
    const expert = roles.body.find((r: { key: string }) => r.key === 'expert');
    await t.http.post(`/v1/admin/memberships/${s.membershipId}/approve`).set(as(tf.adminToken, tf.slug)).send({}).expect(200);
    await t.http
      .post('/v1/admin/role-assignments')
      .set(as(tf.adminToken, tf.slug))
      .send({ membershipId: s.membershipId, roleId: expert.id, scopeType: 'tenant' })
      .expect(201);
    const s2 = await registerStudent(t, tf, facultyId);
    await t.http.post(`/v1/admin/memberships/${s2.membershipId}/reject`).set(as(token, tf.slug)).send({ reason: 'ناقص' }).expect(200);
    await t.http.post(`/v1/admin/memberships/${s.membershipId}/request-revision`).set(as(token, tf.slug)).send({ reason: 'x', fields: ['profile'] }).expect(403);
  });

  it('anonymous upload requires a mobile proof and rejects disguised files (FIL-03)', async () => {
    const noProof = await t.http.post('/v1/files').set({ 'x-tenant': tf.slug }).field('purpose', 'membership_document').attach('file', Buffer.from('hello'), 'x.png').expect(400);
    expect(noProof.body.error.code).toBe('PROOF_INVALID');
    await t.http
      .post('/v1/files')
      .set(as(tf.adminToken, tf.slug))
      .field('purpose', 'membership_document')
      .attach('file', Buffer.from('MZ\x90\x00 not really a png at all'), 'card.png')
      .expect(415);
  });
});
