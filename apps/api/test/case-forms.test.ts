import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createPlatformAdmin, createTenant, createUnit, login, nextMobile, PNG, registerStudent, setPasswordViaReset, startApp, type TenantFixture, type TestApp } from './helpers.js';

const definition = {
  requestForm: [
    { key: 'topic', type: 'text', label: 'موضوع', required: true },
    { key: 'pages', type: 'number', label: 'تعداد صفحات' },
    { key: 'proposal', type: 'file', label: 'فایل پروپوزال' },
  ],
  start: 'check',
  steps: [
    {
      id: 'check',
      type: 'human',
      title: 'بررسی',
      assignee: { role: 'expert', scope: 'case_unit_tree' },
      actions: ['approve', 'return_for_fix'],
      form: [
        { key: 'review', type: 'file', label: 'نظر داور', visibility: 'internal' },
        { key: 'summary', type: 'file', label: 'خلاصه برای متقاضی' },
      ],
    },
    { id: 'done', type: 'end', title: 'پایان', outcome: 'success' },
  ],
  transitions: [
    { from: 'check', action: 'approve', to: 'done' },
    { from: 'check', action: 'return_for_fix', to: '@applicant' },
  ],
};

describe('request form and case attachments (WF-10, FIL)', () => {
  let t: TestApp;
  let tf: TenantFixture;
  let student: string;
  let expert: string;
  const admin = () => as(tf.adminToken, tf.slug);
  const upload = async (token: string) =>
    (await t.http.post('/v1/files').set(as(token, tf.slug)).field('purpose', 'case_attachment').attach('file', PNG, 'a.png').expect(201)).body.id as string;
  const downloadLink = (token: string, id: string) => t.http.post(`/v1/files/${id}/download-link`).set(as(token, tf.slug));

  beforeAll(async () => {
    t = await startApp();
    const platform = await createPlatformAdmin(t);
    tf = await createTenant(t, platform.token);
    const unit = (await createUnit(t, tf, 'دانشکده')).id;
    const roles = (await t.http.get('/v1/admin/roles').set(admin())).body as { id: string; key: string }[];
    const mobile = nextMobile();
    const inv = await t.http.post('/v1/admin/memberships/invite').set(admin()).send({ kind: 'staff', fullName: 'کارشناس', mobile, unitId: unit }).expect(201);
    await t.http.post('/v1/admin/role-assignments').set(admin()).send({ membershipId: inv.body.membershipId, roleId: roles.find((r) => r.key === 'expert')!.id, scopeType: 'tenant' }).expect(201);
    await setPasswordViaReset(t, mobile, 'Expert#Pass123');
    expert = await login(t, mobile, 'Expert#Pass123');
    const s = await registerStudent(t, tf, unit);
    await t.http.post(`/v1/admin/memberships/${s.membershipId}/approve`).set(admin()).send({}).expect(200);
    student = await login(t, s.mobile, s.password);

    const w = await t.http.post('/v1/admin/workflows').set(admin()).send({ key: 'proposal', nameFa: 'پروپوزال', requestType: 'proposal' }).expect(201);
    const v = (await t.http.get(`/v1/admin/workflows/${w.body.id}`).set(admin())).body.versions[0].id;
    await t.http.patch(`/v1/admin/workflow-versions/${v}`).set(admin()).send({ definition }).expect(200);
    expect((await t.http.post(`/v1/admin/workflow-versions/${v}/validate`).set(admin())).body.issues).toEqual([]);
    await t.http.post(`/v1/admin/workflow-versions/${v}/publish`).set(admin()).expect(200);
  });
  afterAll(() => t.close());

  it('request types expose the form; data must match it', async () => {
    const types = await t.http.get('/v1/cases/request-types').set(as(student, tf.slug)).expect(200);
    expect(types.body.find((x: { requestType: string }) => x.requestType === 'proposal').requestForm.map((f: { key: string }) => f.key)).toEqual(['topic', 'pages', 'proposal']);

    const bad = await t.http.post('/v1/cases').set(as(student, tf.slug)).send({ requestType: 'proposal', data: { pages: 'ten', extra: 1 } }).expect(400);
    expect(bad.body.error.details.fields).toEqual({ topic: 'required', pages: 'invalid', extra: 'unknown' });
  });

  it('attachments: applicant sees public files only; staff see all; outsiders none', async () => {
    const proposal = await upload(student);
    const c = await t.http.post('/v1/cases').set(as(student, tf.slug)).send({ requestType: 'proposal', title: 'x', data: { topic: 'هوش', pages: 40, proposal } }).expect(201);
    expect(c.body.labels.topic).toBe('موضوع');
    expect(c.body.attachments.map((a: { id: string; field: string }) => [a.id, a.field])).toEqual([[proposal, 'proposal']]);

    const sv = await t.http.get(`/v1/cases/${c.body.id}`).set(as(expert, tf.slug)).expect(200);
    const task = sv.body.tasks.find((x: { status: string }) => x.status === 'open');
    await downloadLink(expert, proposal).expect(201); // staff on the case can open the applicant's file

    const review = await upload(expert);
    const summary = await upload(expert);
    // someone else's upload cannot be attached
    const foreign = await upload(student);
    await t.http.post(`/v1/cases/${c.body.id}/tasks/${task.id}/actions`).set(as(expert, tf.slug)).send({ action: 'approve', form: { review: foreign } }).expect(400);
    await t.http.post(`/v1/cases/${c.body.id}/tasks/${task.id}/actions`).set(as(expert, tf.slug)).send({ action: 'approve', form: { review, summary } }).expect(200);

    const mine = await t.http.get(`/v1/cases/${c.body.id}`).set(as(student, tf.slug)).expect(200);
    const ids = mine.body.attachments.map((a: { id: string }) => a.id);
    expect(ids).toContain(summary);
    expect(ids).not.toContain(review);
    await downloadLink(student, summary).expect(201);
    await downloadLink(student, review).expect(404); // internal field stays internal

    const platform = await createPlatformAdmin(t);
    const other = await createTenant(t, platform.token);
    await t.http.post(`/v1/files/${review}/download-link`).set(as(other.adminToken, other.slug)).expect(404);
  });

  it('revision may only change request-form fields and must stay valid', async () => {
    const c = await t.http.post('/v1/cases').set(as(student, tf.slug)).send({ requestType: 'proposal', data: { topic: 'اول' } }).expect(201);
    const sv = await t.http.get(`/v1/cases/${c.body.id}`).set(as(expert, tf.slug)).expect(200);
    const task = sv.body.tasks.find((x: { status: string }) => x.status === 'open');
    await t.http.post(`/v1/cases/${c.body.id}/tasks/${task.id}/actions`).set(as(expert, tf.slug)).send({ action: 'return_for_fix' }).expect(200);
    const view = await t.http.get(`/v1/cases/${c.body.id}`).set(as(student, tf.slug)).expect(200);
    const act = (data: Record<string, unknown>) => t.http.post(`/v1/cases/${c.body.id}/tasks/${view.body.revisionTaskId}/actions`).set(as(student, tf.slug)).send({ action: 'resubmit', data });
    await act({ hacked: true }).expect(400);
    await act({ topic: '' }).expect(400);
    await act({ topic: 'دوم', pages: 12 }).expect(200);
    expect((await t.http.get(`/v1/cases/${c.body.id}`).set(as(student, tf.slug))).body.data).toMatchObject({ topic: 'دوم', pages: 12 });
  });

  it('sandbox runs a draft without storing anything (WF-15)', async () => {
    const wf = (await t.http.get('/v1/admin/workflows').set(admin())).body.find((w: { key: string }) => w.key === 'proposal');
    const draft = (await t.http.post(`/v1/admin/workflows/${wf.id}/versions`).set(admin()).send({}).expect(201)).body.id;
    const casesBefore = (await t.http.get('/v1/me/cases').set(admin())).body.total;
    await t.flush();
    const outboxBefore = (await t.http.get('/v1/me/notifications/unread-count').set(as(expert, tf.slug))).body.unread;

    const run = await t.http
      .post(`/v1/admin/workflow-versions/${draft}/simulate`)
      .set(admin())
      .send({ data: { topic: 'آزمایشی' }, script: [{ action: 'return_for_fix' }, { action: 'resubmit', data: { topic: 'اصلاح' } }, { action: 'approve' }] })
      .expect(200);
    expect(run.body.ok).toBe(true);
    expect(run.body.status).toBe('success');
    expect(run.body.path.map((p: { type: string }) => p.type)).toEqual(['created', 'entered', 'action', 'returned', 'resubmitted', 'entered', 'action', 'entered', 'closed']);
    expect(run.body.data.topic).toBe('اصلاح');

    const stuck = await t.http.post(`/v1/admin/workflow-versions/${draft}/simulate`).set(admin()).send({ data: { topic: 'x' }, script: [{ action: 'publish' }] }).expect(200);
    expect(stuck.body).toMatchObject({ ok: false, error: { code: 'INVALID_STATE_TRANSITION' } });
    expect(stuck.body.open.map((o: { stepId: string }) => o.stepId)).toEqual(['check']);

    const invalid = await t.http.post(`/v1/admin/workflow-versions/${draft}/simulate`).set(admin()).send({ data: {}, script: [] }).expect(200);
    expect(invalid.body).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });

    expect((await t.http.get('/v1/me/cases').set(admin())).body.total).toBe(casesBefore);
    await t.flush();
    expect((await t.http.get('/v1/me/notifications/unread-count').set(as(expert, tf.slug))).body.unread).toBe(outboxBefore);
  });

  it('templates instantiate as drafts; a faculty copy publishes alongside its source (WF-11/19)', async () => {
    const list = await t.http.get('/v1/admin/workflow-templates').set(admin()).expect(200);
    expect(list.body.map((x: { key: string }) => x.key)).toEqual(expect.arrayContaining(['general-request', 'thesis-proposal', 'paper-review']));
    const w = await t.http
      .post('/v1/admin/workflow-templates/general-request/instantiate')
      .set(admin())
      .send({ key: 'cert', nameFa: 'گواهی', requestType: 'certificate' })
      .expect(201);
    const v1 = (await t.http.get(`/v1/admin/workflows/${w.body.id}`).set(admin())).body.versions[0];
    expect(v1.status).toBe('draft');
    expect((await t.http.post(`/v1/admin/workflow-versions/${v1.id}/validate`).set(admin())).body.ok).toBe(true);
    await t.http.post(`/v1/admin/workflow-versions/${v1.id}/publish`).set(admin()).expect(200);

    const unit = (await createUnit(t, tf, 'دانشکده علوم')).id;
    await t.http.post(`/v1/admin/workflows/${w.body.id}/copy`).set(admin()).send({ key: 'cert-sci', nameFa: 'گواهی علوم', unitIds: [] }).expect(400);
    const copy = await t.http.post(`/v1/admin/workflows/${w.body.id}/copy`).set(admin()).send({ key: 'cert-sci', nameFa: 'گواهی علوم', unitIds: [unit] }).expect(201);
    expect(copy.body.requestType).toBe('certificate');
    const cv = (await t.http.get(`/v1/admin/workflows/${copy.body.id}`).set(admin())).body.versions[0].id;
    const full = (await t.http.get(`/v1/admin/workflow-versions/${cv}`).set(admin())).body;
    expect(full.selector).toEqual({ requestType: 'certificate', unitIds: [unit] });
    await t.http.post(`/v1/admin/workflow-versions/${cv}/validate`).set(admin()).expect(200);
    // narrower than the source, so both can be published; cases in that unit use the copy
    await t.http.post(`/v1/admin/workflow-versions/${cv}/publish`).set(admin()).expect(200);
    const again = await t.http.post(`/v1/admin/workflows/${w.body.id}/copy`).set(admin()).send({ key: 'cert-sci2', nameFa: 'تکراری', unitIds: [unit] }).expect(201);
    const av = (await t.http.get(`/v1/admin/workflows/${again.body.id}`).set(admin())).body.versions[0].id;
    await t.http.post(`/v1/admin/workflow-versions/${av}/validate`).set(admin()).expect(200);
    expect((await t.http.post(`/v1/admin/workflow-versions/${av}/publish`).set(admin()).expect(409)).body.error.code).toBe('SELECTOR_OVERLAP');

    const inSci = await t.http.post('/v1/cases').set(as(student, tf.slug)).send({ requestType: 'certificate', unitId: unit, data: { subject: 'x', details: 'y' } }).expect(201);
    expect(inSci.body.workflowName).toBe('گواهی علوم');
    const elsewhere = await t.http.post('/v1/cases').set(as(student, tf.slug)).send({ requestType: 'certificate', data: { subject: 'x', details: 'y' } }).expect(201);
    expect(elsewhere.body.workflowName).toBe('گواهی');
  });
});
