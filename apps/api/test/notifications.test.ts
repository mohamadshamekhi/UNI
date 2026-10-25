import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { afterQuietHours } from '../src/modules/notifications/notifications.service.js';
import {
  as,
  createPlatformAdmin,
  createTenant,
  createUnit,
  login,
  nextMobile,
  registerStudent,
  setPasswordViaReset,
  startApp,
  sysPool,
  toE164,
  type TenantFixture,
  type TestApp,
} from './helpers.js';

const definition = {
  start: 'check',
  steps: [
    { id: 'check', type: 'human', title: 'بررسی کارشناس', assignee: { role: 'expert', scope: 'case_unit_tree' }, actions: ['approve', 'return_for_fix'] },
    { id: 'done', type: 'end', title: 'پایان', outcome: 'success' },
  ],
  transitions: [
    { from: 'check', action: 'approve', to: 'done' },
    { from: 'check', action: 'return_for_fix', to: '@applicant' },
  ],
};

interface Inbox {
  items: { id: string; event: string; title: string; body: string; link: string | null; readAt: string | null }[];
  total: number;
  unread: number;
}

describe('notifications (section 13)', () => {
  let t: TestApp;
  let tf: TenantFixture;
  let student: { token: string; mobile: string; membershipId: string };
  let expert: { token: string; mobile: string };
  const pool = sysPool();
  const admin = () => as(tf.adminToken, tf.slug);
  const inbox = async (token: string) => (await t.http.get('/v1/me/notifications').set(as(token, tf.slug)).expect(200)).body as Inbox;
  const smsTo = (mobile: string) => t.sms.sent.filter((m) => m.to === toE164(mobile)).map((m) => m.text);

  async function newCase(title: string) {
    const c = await t.http.post('/v1/cases').set(as(student.token, tf.slug)).send({ requestType: 'ntf_case', title }).expect(201);
    const sv = await t.http.get(`/v1/cases/${c.body.id}`).set(admin()).expect(200);
    return { id: c.body.id as string, taskId: sv.body.tasks.find((x: { status: string }) => x.status === 'open').id as string };
  }

  beforeAll(async () => {
    t = await startApp();
    const platform = await createPlatformAdmin(t);
    tf = await createTenant(t, platform.token);
    const faculty = (await createUnit(t, tf, 'دانشکده فنی')).id;
    const roles = (await t.http.get('/v1/admin/roles').set(admin())).body as { id: string; key: string }[];

    const mobile = nextMobile();
    const inv = await t.http.post('/v1/admin/memberships/invite').set(admin()).send({ kind: 'staff', fullName: 'کارشناس', mobile, unitId: faculty }).expect(201);
    await t.http
      .post('/v1/admin/role-assignments')
      .set(admin())
      .send({ membershipId: inv.body.membershipId, roleId: roles.find((r) => r.key === 'expert')!.id, scopeType: 'unit_tree', scopeId: faculty })
      .expect(201);
    await setPasswordViaReset(t, mobile, 'Expert#Pass123');
    expert = { token: await login(t, mobile, 'Expert#Pass123'), mobile };

    const s = await registerStudent(t, tf, faculty);
    await t.http.post(`/v1/admin/memberships/${s.membershipId}/approve`).set(admin()).send({}).expect(200);
    student = { token: await login(t, s.mobile, s.password), mobile: s.mobile, membershipId: s.membershipId };

    const w = await t.http.post('/v1/admin/workflows').set(admin()).send({ key: 'ntf-case', nameFa: 'درخواست آزمایشی', requestType: 'ntf_case' }).expect(201);
    const v = (await t.http.get(`/v1/admin/workflows/${w.body.id}`).set(admin())).body.versions[0].id;
    await t.http.patch(`/v1/admin/workflow-versions/${v}`).set(admin()).send({ definition }).expect(200);
    await t.http.post(`/v1/admin/workflow-versions/${v}/validate`).set(admin()).expect(200);
    await t.http.post(`/v1/admin/workflow-versions/${v}/publish`).set(admin()).expect(200);
  });
  afterAll(async () => {
    await pool.end();
    await t.close();
  });

  it('membership decision lands in the inbox and as SMS; read state works (NTF-09)', async () => {
    await t.flush();
    const box = await inbox(student.token);
    const n = box.items.find((i) => i.event === 'membership.decided');
    expect(n).toMatchObject({ title: 'درخواست عضویت تأیید شد', link: `/${tf.slug}/me`, readAt: null });
    expect(box.unread).toBeGreaterThan(0);
    expect(smsTo(student.mobile).some((x) => x.includes('تأیید شد'))).toBe(true);

    await t.http.post(`/v1/me/notifications/${n!.id}/read`).set(as(student.token, tf.slug)).expect(204);
    // nobody else can mark it
    await t.http.post(`/v1/me/notifications/${n!.id}/read`).set(as(expert.token, tf.slug)).expect(404);
    await t.http.post('/v1/me/notifications/read-all').set(as(student.token, tf.slug)).expect(204);
    expect((await t.http.get('/v1/me/notifications/unread-count').set(as(student.token, tf.slug))).body.unread).toBe(0);
  });

  it('new tasks notify every eligible assignee, never the applicant', async () => {
    const c = await newCase('موضوع محرمانه');
    await t.flush();
    const box = await inbox(expert.token);
    const n = box.items.find((i) => i.event === 'case.task.assigned' && i.link === `/t/${tf.slug}/cases/${c.id}`);
    expect(n?.title).toBe('کار جدید: بررسی کارشناس');
    expect((await inbox(student.token)).items.some((i) => i.event === 'case.task.assigned')).toBe(false);
  });

  it('templates: variables are checked and confidential ones never leave the system (NTF-02/07)', async () => {
    const bad = await t.http
      .put('/v1/admin/notification-templates')
      .set(admin())
      .send({ event: 'case.returned', channel: 'sms', body: 'پرونده «{{caseTitle}}» برگشت' })
      .expect(400);
    expect(bad.body.error.details.problems).toEqual(['sensitive_variable:caseTitle']);
    const preview = await t.http
      .post('/v1/admin/notification-templates/preview')
      .set(admin())
      .send({ event: 'case.returned', channel: 'inapp', body: '{{caseRef}} {{nope}}' })
      .expect(200);
    expect(preview.body).toMatchObject({ problems: ['unknown_variable:nope'], body: 'A1B2C3D4 ' });

    await t.http
      .put('/v1/admin/notification-templates')
      .set(admin())
      .send({ event: 'case.returned', channel: 'sms', body: 'اصلاح لازم است: {{caseRef}}' })
      .expect(200);
    const c = await newCase('عنوان سری');
    await t.http.post(`/v1/cases/${c.id}/tasks/${c.taskId}/actions`).set(as(expert.token, tf.slug)).send({ action: 'return_for_fix' }).expect(200);
    await t.flush();
    const sms = smsTo(student.mobile).at(-1)!;
    expect(sms).toBe(`اصلاح لازم است: ${c.id.slice(0, 8).toUpperCase()}`);
    expect(sms).not.toContain('عنوان سری');

    const list = await t.http.get('/v1/admin/notification-templates').set(admin()).expect(200);
    const returned = list.body.find((e: { event: string }) => e.event === 'case.returned');
    expect(returned.templates.find((x: { channel: string }) => x.channel === 'sms').override.body).toContain('اصلاح لازم است');
    await t.http.delete('/v1/admin/notification-templates/case.returned/sms').set(admin()).expect(204);
  });

  it('rules switch channels off; user mutes skip non-critical channels (NTF-03/10)', async () => {
    await t.http.put('/v1/admin/notification-rules').set(admin()).send({ event: 'case.closed', recipient: 'applicant', channels: ['inapp'], enabled: true }).expect(200);
    const before = smsTo(student.mobile).length;
    const c = await newCase('بستن');
    await t.http.post(`/v1/cases/${c.id}/tasks/${c.taskId}/actions`).set(as(expert.token, tf.slug)).send({ action: 'approve' }).expect(200);
    await t.flush();
    expect(smsTo(student.mobile).length).toBe(before);
    expect((await inbox(student.token)).items.some((i) => i.event === 'case.closed')).toBe(true);

    await t.http.put('/v1/me/notification-preferences').set(as(student.token, tf.slug)).send({ muted: ['inapp'] }).expect(200);
    const c2 = await newCase('بی‌صدا');
    await t.http.post(`/v1/cases/${c2.id}/tasks/${c2.taskId}/actions`).set(as(expert.token, tf.slug)).send({ action: 'approve' }).expect(200);
    await t.flush();
    const closed = (await inbox(student.token)).items.filter((i) => i.event === 'case.closed');
    expect(closed).toHaveLength(1); // the muted one never arrived
    await t.http.put('/v1/me/notification-preferences').set(as(student.token, tf.slug)).send({ muted: [] }).expect(200);
  });

  it('the same event never notifies twice (NTF-05)', async () => {
    const c = await newCase('یکتا');
    const e = { id: 987654321, tenantId: tf.id, payload: { caseId: c.id, taskId: c.taskId } };
    expect(await t.notify.dispatch('case.task.assigned', e)).toBeGreaterThan(0);
    expect(await t.notify.dispatch('case.task.assigned', e)).toBe(0);
  });

  it('failed sends retry with backoff, then dead-letter; the report masks recipients (NTF-04/06)', async () => {
    await t.flush();
    const spy = vi.spyOn(t.sms, 'send').mockRejectedValue(new Error('provider down'));
    const c = await newCase('خطا');
    await t.http.post(`/v1/cases/${c.id}/tasks/${c.taskId}/actions`).set(as(expert.token, tf.slug)).send({ action: 'return_for_fix' }).expect(200);
    while ((await t.outbox.drain()) > 0);
    let at = Date.now() + 12 * 3_600_000;
    for (let i = 0; i < 6; i++) {
      await t.notify.deliver(new Date(at));
      at += 3_600_000;
    }
    spy.mockRestore();
    const report = await t.http.get('/v1/admin/notification-deliveries?status=dead&channel=sms').set(admin()).expect(200);
    const row = report.body.items.find((r: { event: string }) => r.event === 'case.returned');
    expect(row).toMatchObject({ attempts: 5, error: 'provider down' });
    expect(row.recipient).not.toContain(student.mobile.slice(3, 9));
  });

  it('SMS stops at the monthly cap (NTF-11)', async () => {
    await pool.query(`update tenants set settings = jsonb_set(settings, '{notifications}', '{"smsMonthlyQuota": 0}') where id = $1`, [tf.id]);
    const c = await newCase('سقف');
    await t.http.post(`/v1/cases/${c.id}/tasks/${c.taskId}/actions`).set(as(expert.token, tf.slug)).send({ action: 'return_for_fix' }).expect(200);
    await t.flush();
    const report = await t.http.get('/v1/admin/notification-deliveries?status=dead').set(admin()).expect(200);
    expect(report.body.items.some((r: { error: string }) => r.error === 'sms_quota_exceeded')).toBe(true);
    expect(report.body.sms).toMatchObject({ monthlyQuota: 0, nearQuota: true });
    await pool.query(`update tenants set settings = settings - 'notifications' where id = $1`, [tf.id]);
  });

  it('quiet hours push non-critical SMS to the morning (NTF-13)', () => {
    const tz = 'Asia/Tehran'; // UTC+3:30
    const night = new Date('2026-10-25T20:00:00Z'); // 23:30 local
    expect(afterQuietHours(night, tz).toISOString()).toBe('2026-10-26T03:30:00.000Z'); // 07:00 local
    const day = new Date('2026-10-25T08:00:00Z');
    expect(afterQuietHours(day, tz)).toBe(day);
  });
});
