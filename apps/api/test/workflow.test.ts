import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  type TenantFixture,
  type TestApp,
} from './helpers.js';
import { SlaService } from '../src/modules/workflow/sla.service.js';

// Sample thesis-like process: expert check → (committee? parallel reviews : advisor) → end
const definition = {
  start: 'expert-check',
  steps: [
    {
      id: 'expert-check',
      type: 'human',
      title: 'بررسی کارشناس',
      assignee: { role: 'expert', scope: 'case_unit_tree' },
      actions: ['approve', 'return_for_fix', 'reject'],
      form: [
        { key: 'committee', type: 'checkbox', label: 'نیاز به کمیته', visibility: 'internal' },
        { key: 'expertNote', type: 'textarea', label: 'یادداشت', visibility: 'internal' },
      ],
      sla: { days: 5 },
    },
    { id: 'route', type: 'decision', title: 'مسیر' },
    { id: 'advisor', type: 'human', title: 'تأیید استاد راهنما', assignee: { dynamic: 'data.advisorId' }, actions: ['approve', 'reject'] },
    { id: 'reviews', type: 'parallel', title: 'داوری', branches: ['review-a', 'review-b'], join: 'all' },
    { id: 'review-a', type: 'human', title: 'داور اول', assignee: { role: 'expert', scope: 'tenant' }, actions: ['approve', 'reject'] },
    { id: 'review-b', type: 'human', title: 'داور دوم', assignee: { dynamic: 'data.advisorId' }, actions: ['approve', 'reject'] },
    { id: 'verdict', type: 'decision', title: 'نتیجه داوری' },
    { id: 'done', type: 'end', title: 'تأیید نهایی', outcome: 'success' },
    { id: 'rejected', type: 'end', title: 'رد', outcome: 'failure' },
  ],
  transitions: [
    { from: 'expert-check', action: 'approve', to: 'route' },
    { from: 'expert-check', action: 'return_for_fix', to: '@applicant' },
    { from: 'expert-check', action: 'reject', to: 'rejected' },
    { from: 'route', when: 'case.internal.committee == true', to: 'reviews' },
    { from: 'route', otherwise: true, to: 'advisor' },
    { from: 'advisor', action: 'approve', to: 'done' },
    { from: 'advisor', action: 'reject', to: 'rejected' },
    { from: 'reviews', to: 'verdict' },
    { from: 'verdict', when: "case.decisions.review_a == 'approve' && case.decisions.review_b == 'approve'", to: 'done' },
    { from: 'verdict', otherwise: true, to: 'rejected' },
  ],
};

interface CaseView {
  id: string;
  view: 'applicant' | 'staff';
  statusCategory: string;
  lockVersion: number;
  current: { stepId: string }[];
  revisionTaskId?: string | null;
  internal?: Record<string, unknown>;
  tasks?: { id: string; stepId: string; status: string; canAct: boolean }[];
  history: { type: string; note?: string; internalNote?: string }[];
}

describe('workflow runtime (section 7)', () => {
  let t: TestApp;
  let tf: TenantFixture;
  let engineering: string;
  let department: string;
  let science: string;
  let roles: { id: string; key: string }[];
  let expert: { token: string; membershipId: string };
  let scienceExpert: { token: string; membershipId: string };
  let advisor: { token: string; membershipId: string };
  let student: { token: string; membershipId: string };
  let workflowId: string;
  let v1: string;

  const admin = () => as(tf.adminToken, tf.slug);

  async function staff(kind: 'staff' | 'faculty', unitId: string, role?: { key: string; scopeType: string; scopeId?: string }) {
    const mobile = nextMobile();
    const inv = await t.http.post('/v1/admin/memberships/invite').set(admin()).send({ kind, fullName: 'همکار', mobile, unitId }).expect(201);
    if (role) {
      await t.http
        .post('/v1/admin/role-assignments')
        .set(admin())
        .send({ membershipId: inv.body.membershipId, roleId: roles.find((r) => r.key === role.key)!.id, scopeType: role.scopeType, scopeId: role.scopeId })
        .expect(201);
    }
    await setPasswordViaReset(t, mobile, 'Staff#Pass1234');
    return { token: await login(t, mobile, 'Staff#Pass1234'), membershipId: inv.body.membershipId as string };
  }

  const startCase = (data: Record<string, unknown>, token = student.token) =>
    t.http.post('/v1/cases').set(as(token, tf.slug)).send({ requestType: 'thesis_proposal', title: 'پروپوزال', data });

  const act = (caseId: string, taskId: string, token: string, body: Record<string, unknown>) =>
    t.http.post(`/v1/cases/${caseId}/tasks/${taskId}/actions`).set(as(token, tf.slug)).send(body);

  const openTask = (c: CaseView, stepId: string) => c.tasks!.find((x) => x.stepId === stepId && x.status === 'open')!;

  const staffView = async (caseId: string, token = tf.adminToken) =>
    (await t.http.get(`/v1/cases/${caseId}`).set(as(token, tf.slug)).expect(200)).body as CaseView;

  beforeAll(async () => {
    t = await startApp();
    const platform = await createPlatformAdmin(t);
    tf = await createTenant(t, platform.token);
    engineering = (await createUnit(t, tf, 'دانشکده مهندسی')).id;
    science = (await createUnit(t, tf, 'دانشکده علوم')).id;
    const types = (await t.http.get('/v1/admin/unit-types').set(admin())).body as { id: string; key: string }[];
    department = (await createUnit(t, tf, 'گروه کامپیوتر', engineering, types.find((x) => x.key === 'department')!.id)).id;
    roles = (await t.http.get('/v1/admin/roles').set(admin()).expect(200)).body;

    expert = await staff('staff', engineering, { key: 'expert', scopeType: 'unit_tree', scopeId: engineering });
    scienceExpert = await staff('staff', science, { key: 'expert', scopeType: 'unit_tree', scopeId: science });
    advisor = await staff('faculty', department);

    const s = await registerStudent(t, tf, department);
    await t.http.post(`/v1/admin/memberships/${s.membershipId}/approve`).set(admin()).send({}).expect(200);
    student = { token: await login(t, s.mobile, s.password), membershipId: s.membershipId };
  });
  afterAll(() => t.close());

  it('definition lifecycle: draft → validate → publish (WF-14)', async () => {
    const w = await t.http
      .post('/v1/admin/workflows')
      .set(admin())
      .send({ key: 'thesis-proposal', nameFa: 'تصویب پروپوزال', requestType: 'thesis_proposal' })
      .expect(201);
    workflowId = w.body.id;
    const detail = await t.http.get(`/v1/admin/workflows/${workflowId}`).set(admin()).expect(200);
    v1 = detail.body.versions[0].id;

    // no case can start before anything is published
    await startCase({ advisorId: advisor.membershipId }).expect(404);

    const broken = structuredClone(definition);
    broken.steps[0]!.assignee = { role: 'no_such_role', scope: 'tenant' };
    await t.http.patch(`/v1/admin/workflow-versions/${v1}`).set(admin()).send({ definition: broken }).expect(200);
    const bad = await t.http.post(`/v1/admin/workflow-versions/${v1}/validate`).set(admin()).expect(200);
    expect(bad.body.ok).toBe(false);
    expect(bad.body.issues.map((i: { code: string }) => i.code)).toContain('unknown_role');
    await t.http.post(`/v1/admin/workflow-versions/${v1}/publish`).set(admin()).expect(409);

    await t.http.patch(`/v1/admin/workflow-versions/${v1}`).set(admin()).send({ definition }).expect(200);
    const ok = await t.http.post(`/v1/admin/workflow-versions/${v1}/validate`).set(admin()).expect(200);
    expect(ok.body).toEqual({ ok: true, issues: [] });
    await t.http.post(`/v1/admin/workflow-versions/${v1}/publish`).set(admin()).expect(200);

    // published versions are frozen
    const locked = await t.http.patch(`/v1/admin/workflow-versions/${v1}`).set(admin()).send({ definition }).expect(409);
    expect(locked.body.error.code).toBe('WORKFLOW_VERSION_LOCKED');
  });

  it('a student cannot define workflows', async () => {
    await t.http.get('/v1/admin/workflows').set(as(student.token, tf.slug)).expect(403);
  });

  it('routes the first task to experts covering the case unit only (WF-01)', async () => {
    const created = await startCase({ advisorId: advisor.membershipId }).expect(201);
    const c = created.body as CaseView;
    expect(c.view).toBe('applicant');
    expect(c.current.map((s) => s.stepId)).toEqual(['expert-check']);

    const mine = (await t.http.get('/v1/me/tasks').set(as(expert.token, tf.slug)).expect(200)).body as { caseId: string; dueAt: string | null }[];
    const task = mine.find((x) => x.caseId === c.id);
    expect(task).toBeDefined();
    expect(task!.dueAt).not.toBeNull(); // SLA due date (WF-20)

    const other = (await t.http.get('/v1/me/tasks').set(as(scienceExpert.token, tf.slug)).expect(200)).body as { caseId: string }[];
    expect(other.some((x) => x.caseId === c.id)).toBe(false);

    const sv = await staffView(c.id);
    const taskId = openTask(sv, 'expert-check').id;
    await act(c.id, taskId, scienceExpert.token, { action: 'approve' }).expect(403);
    // the applicant can never act on their own review step (SoD)
    const sod = await act(c.id, taskId, student.token, { action: 'approve' }).expect(403);
    expect(sod.body.error.code).toBe('SEPARATION_OF_DUTIES');
    // out-of-scope staff cannot even open the case
    await t.http.get(`/v1/cases/${c.id}`).set(as(scienceExpert.token, tf.slug)).expect(404);
  });

  it('revision loop through @applicant, then advisor approval closes the case', async () => {
    const c = (await startCase({ advisorId: advisor.membershipId }).expect(201)).body as CaseView;
    let sv = await staffView(c.id, expert.token);
    await act(c.id, openTask(sv, 'expert-check').id, expert.token, {
      action: 'return_for_fix',
      publicNote: 'عنوان را اصلاح کنید',
      internalNote: 'برای بار دوم',
    }).expect(200);

    const applicantView = (await t.http.get(`/v1/cases/${c.id}`).set(as(student.token, tf.slug)).expect(200)).body as CaseView;
    expect(applicantView.statusCategory).toBe('revising');
    expect(applicantView.revisionTaskId).toBeTruthy();
    expect(JSON.stringify(applicantView)).not.toContain('برای بار دوم'); // internal notes stay internal
    expect(applicantView.history.some((h) => h.note === 'عنوان را اصلاح کنید')).toBe(true);

    await act(c.id, applicantView.revisionTaskId!, student.token, { action: 'resubmit', data: { topic: 'جدید' } }).expect(200);
    sv = await staffView(c.id, expert.token);
    expect(sv.statusCategory).toBe('open');
    expect(sv.current.map((s) => s.stepId)).toEqual(['expert-check']);

    const after = await act(c.id, openTask(sv, 'expert-check').id, expert.token, {
      action: 'approve',
      form: { committee: false, expertNote: 'ok' },
    }).expect(200);
    expect(after.body.current.map((s: { stepId: string }) => s.stepId)).toEqual(['advisor']);
    expect(after.body.internal).toEqual({ committee: false, expertNote: 'ok' });

    const advisorTasks = (await t.http.get('/v1/me/tasks').set(as(advisor.token, tf.slug)).expect(200)).body as { id: string; caseId: string }[];
    const at = advisorTasks.find((x) => x.caseId === c.id)!;
    const done = await act(c.id, at.id, advisor.token, { action: 'approve' }).expect(200);
    expect(done.body.statusCategory).toBe('success');
    expect(done.body.current).toEqual([]);
  });

  it('rejects unknown actions and invalid form values', async () => {
    const c = (await startCase({ advisorId: advisor.membershipId }).expect(201)).body as CaseView;
    const id = openTask(await staffView(c.id), 'expert-check').id;
    await act(c.id, id, expert.token, { action: 'publish' }).expect(400);
    const bad = await act(c.id, id, expert.token, { action: 'approve', form: { committee: 'yes', extra: 1 } }).expect(400);
    expect(bad.body.error.details.fields).toEqual({ committee: 'invalid', extra: 'unknown' });
  });

  it('double submit: exactly one transition wins (WF-05)', async () => {
    const c = (await startCase({ advisorId: advisor.membershipId }).expect(201)).body as CaseView;
    const id = openTask(await staffView(c.id), 'expert-check').id;
    const results = await Promise.all([
      act(c.id, id, expert.token, { action: 'reject' }),
      act(c.id, id, expert.token, { action: 'approve', form: { committee: false } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const sv = await staffView(c.id);
    expect(sv.history.filter((h) => h.type === 'action')).toHaveLength(1);

    // a stale expectedVersion is refused too
    const c2 = (await startCase({ advisorId: advisor.membershipId }).expect(201)).body as CaseView;
    const t2 = openTask(await staffView(c2.id), 'expert-check').id;
    const stale = await act(c2.id, t2, expert.token, { action: 'reject', expectedVersion: c2.lockVersion + 5 }).expect(409);
    expect(stale.body.error.code).toBe('CASE_STALE');
  });

  it('parallel reviews join before the verdict', async () => {
    const c = (await startCase({ advisorId: advisor.membershipId }).expect(201)).body as CaseView;
    let sv = await staffView(c.id);
    await act(c.id, openTask(sv, 'expert-check').id, expert.token, { action: 'approve', form: { committee: true } }).expect(200);
    sv = await staffView(c.id);
    expect(sv.current.map((s) => s.stepId).sort()).toEqual(['review-a', 'review-b']);

    // review-a is a tenant-wide expert task: the science expert may take it
    await act(c.id, openTask(sv, 'review-a').id, scienceExpert.token, { action: 'approve' }).expect(200);
    sv = await staffView(c.id);
    expect(sv.current.map((s) => s.stepId)).toEqual(['review-b']);
    expect(sv.statusCategory).toBe('open');

    await act(c.id, openTask(sv, 'review-b').id, advisor.token, { action: 'reject' }).expect(200);
    sv = await staffView(c.id);
    expect(sv.statusCategory).toBe('failure');
  });

  it('running cases stay pinned to their version (WF-06)', async () => {
    const old = (await startCase({ advisorId: advisor.membershipId }).expect(201)).body as CaseView;

    const next = structuredClone(definition);
    next.steps[0]!.title = 'بررسی کارشناس (نسخه ۲)';
    const v2 = await t.http.post(`/v1/admin/workflows/${workflowId}/versions`).set(admin()).send({ definition: next }).expect(201);
    await t.http.post(`/v1/admin/workflow-versions/${v2.body.id}/validate`).set(admin()).expect(200);
    const impact = await t.http.get(`/v1/admin/workflow-versions/${v2.body.id}/impact`).set(admin()).expect(200);
    expect(impact.body.replaces).toEqual([1]);
    expect(impact.body.openCasesOnPrevious).toBeGreaterThan(0);
    await t.http.post(`/v1/admin/workflow-versions/${v2.body.id}/publish`).set(admin()).expect(200);

    const oldView = await staffView(old.id);
    expect(oldView.current[0]).toMatchObject({ stepId: 'expert-check', title: 'بررسی کارشناس' });
    const fresh = (await startCase({ advisorId: advisor.membershipId }).expect(201)).body as { current: { title: string }[] };
    expect(fresh.current[0]!.title).toBe('بررسی کارشناس (نسخه ۲)');

    // the old case still completes on v1
    await act(old.id, openTask(oldView, 'expert-check').id, expert.token, { action: 'reject' }).expect(200);
    expect((await staffView(old.id)).statusCategory).toBe('failure');
  });

  it('a dynamic assignee pointing at the applicant is refused (SoD)', async () => {
    const c = (await startCase({ advisorId: student.membershipId }).expect(201)).body as CaseView;
    const res = await act(c.id, openTask(await staffView(c.id), 'expert-check').id, expert.token, { action: 'approve' }).expect(403);
    expect(res.body.error.code).toBe('SEPARATION_OF_DUTIES');
  });

  it('reassign and extend need case.assign and leave a trail (WF-12/23)', async () => {
    const c = (await startCase({ advisorId: advisor.membershipId }).expect(201)).body as CaseView;
    const id = openTask(await staffView(c.id), 'expert-check').id;
    await t.http.post(`/v1/cases/${c.id}/tasks/${id}/reassign`).set(as(advisor.token, tf.slug)).send({ membershipId: scienceExpert.membershipId, reason: 'x' }).expect(403);
    await t.http
      .post(`/v1/cases/${c.id}/tasks/${id}/reassign`)
      .set(admin())
      .send({ membershipId: student.membershipId, reason: 'x' })
      .expect(403);
    await t.http.post(`/v1/cases/${c.id}/tasks/${id}/reassign`).set(admin()).send({ membershipId: scienceExpert.membershipId, reason: 'مرخصی' }).expect(200);
    await t.http.post(`/v1/cases/${c.id}/tasks/${id}/extend`).set(admin()).send({ days: 3, reason: 'تمدید' }).expect(200);

    const other = (await t.http.get('/v1/me/tasks').set(as(scienceExpert.token, tf.slug)).expect(200)).body as { id: string }[];
    expect(other.some((x) => x.id === id)).toBe(true);
    const sv = await staffView(c.id);
    expect(sv.history.filter((h) => h.type === 'reassigned' || h.type === 'extended').map((h) => h.internalNote)).toEqual(['مرخصی', 'تمدید']);
  });

  it('lists: applicant sees own cases; staff list is scoped', async () => {
    const mine = await t.http.get('/v1/me/cases').set(as(student.token, tf.slug)).expect(200);
    expect(mine.body.total).toBeGreaterThan(3);
    const scoped = await t.http.get('/v1/admin/cases?statusCategory=open').set(as(expert.token, tf.slug)).expect(200);
    expect(scoped.body.total).toBeGreaterThan(0);
    const none = await t.http.get('/v1/admin/cases').set(as(scienceExpert.token, tf.slug)).expect(200);
    expect(none.body.total).toBe(0);
  });

  describe('deadlines (WF-20..24)', () => {
    const DAY = 86_400_000;
    const tehranDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(d);
    const slaDef = (onOverdue: string, extra: Record<string, unknown> = {}) => ({
      start: 'check',
      steps: [
        {
          id: 'check',
          type: 'human',
          title: 'بررسی',
          assignee: { role: 'expert', scope: 'case_unit_tree' },
          actions: ['ok'],
          sla: { days: 2, businessDays: true, remindBefore: [1], remindAfter: [1], onOverdue, ...extra },
        },
        { id: 'done', type: 'end', title: 'پایان', outcome: 'success' },
      ],
      transitions: [{ from: 'check', action: 'ok', to: 'done' }],
    });

    async function publish(requestType: string, def: unknown) {
      const w = await t.http.post('/v1/admin/workflows').set(admin()).send({ key: requestType.replaceAll('_', '-'), nameFa: requestType, requestType }).expect(201);
      const v = (await t.http.get(`/v1/admin/workflows/${w.body.id}`).set(admin())).body.versions[0].id;
      await t.http.patch(`/v1/admin/workflow-versions/${v}`).set(admin()).send({ definition: def }).expect(200);
      expect((await t.http.post(`/v1/admin/workflow-versions/${v}/validate`).set(admin()).expect(200)).body.issues).toEqual([]);
      await t.http.post(`/v1/admin/workflow-versions/${v}/publish`).set(admin()).expect(200);
    }

    const newCase = async (requestType: string) => {
      const c = (await t.http.post('/v1/cases').set(as(student.token, tf.slug)).send({ requestType }).expect(201)).body as CaseView;
      const sv = await staffView(c.id);
      const task = openTask(sv, 'check') as unknown as { id: string; dueAt: string };
      return { id: c.id, taskId: task.id, dueAt: new Date(task.dueAt) };
    };

    it('holidays: national list is shared, university closures are per tenant', async () => {
      const platform = await createPlatformAdmin(t);
      const day = `209${Math.floor(Math.random() * 10)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;
      const nat = await t.http.post('/v1/platform/holidays').set(as(platform.token)).send({ day, title: 'تعطیل رسمی' }).expect(201);
      const list = await t.http.get(`/v1/admin/holidays?from=${day}&to=${day}`).set(admin()).expect(200);
      expect(list.body).toEqual([expect.objectContaining({ day, national: true })]);
      await t.http.delete(`/v1/admin/holidays/${nat.body.id}`).set(admin()).expect(404); // read-only for tenants
      await t.http.post('/v1/admin/holidays').set(as(expert.token, tf.slug)).send({ day, title: 'x' }).expect(403);
      await t.http.delete(`/v1/platform/holidays/${nat.body.id}`).set(as(platform.token)).expect(204);
    });

    it('due dates skip university holidays; reminders, then escalation (WF-20/21/22)', async () => {
      // close the next five days so two business days land after them
      const now = Date.now();
      for (let i = 1; i <= 5; i++) {
        await t.http.post('/v1/admin/holidays').set(admin()).send({ day: tehranDay(new Date(now + i * DAY)), title: 'تعطیلی دانشگاه' }).expect(201);
      }
      await publish('sla_escalate', slaDef('escalate', { escalateTo: { role: 'university_admin', scope: 'tenant' } }));
      const c = await newCase('sla_escalate');
      expect(c.dueAt.getTime()).toBeGreaterThan(now + 6 * DAY);

      const sla = t.app.get(SlaService);
      const pool = sysPool();
      const reminders = async () =>
        (await pool.query("select payload->>'kind' as kind from outbox_events where type = 'case.task.reminder' and idempotency_key like $1 order by id", [`sla:${c.taskId}:%`])).rows.map((r) => r.kind);

      expect(await sla.sweep(new Date(c.dueAt.getTime() - DAY + 60_000))).toBeGreaterThan(0);
      expect(await reminders()).toEqual(['before']);

      await sla.sweep(new Date(c.dueAt.getTime() + 60_000));
      expect(await reminders()).toEqual(['before', 'due']);
      // a second sweep at the same time does nothing (idempotent, WF-24)
      await sla.sweep(new Date(c.dueAt.getTime() + 60_000));
      expect(await reminders()).toEqual(['before', 'due']);

      // escalated to the university admin role: off the expert's cartable, onto the admin's
      const expertTasks = (await t.http.get('/v1/me/tasks').set(as(expert.token, tf.slug))).body as { id: string }[];
      expect(expertTasks.some((x) => x.id === c.taskId)).toBe(false);
      const adminTasks = (await t.http.get('/v1/me/tasks').set(admin())).body as { id: string; overdue: boolean }[];
      expect(adminTasks.find((x) => x.id === c.taskId)?.overdue).toBe(true);
      expect((await staffView(c.id)).history.map((h) => h.type)).toContain('escalated');

      await sla.sweep(new Date(c.dueAt.getTime() + DAY + 60_000));
      expect(await reminders()).toEqual(['before', 'due', 'after']);
      await pool.end();
    });

    it('auto-close after the deadline, and manual extension restarts reminders', async () => {
      await publish('sla_close', slaDef('close'));
      const sla = t.app.get(SlaService);

      const extended = await newCase('sla_close');
      const r = await t.http.post(`/v1/cases/${extended.id}/tasks/${extended.taskId}/extend`).set(admin()).send({ days: 10, reason: 'تمدید' }).expect(200);
      await sla.sweep(new Date(extended.dueAt.getTime() + 60_000));
      expect((await staffView(extended.id)).statusCategory).toBe('open'); // new deadline not reached
      expect(new Date(r.body.dueAt).getTime()).toBeGreaterThan(extended.dueAt.getTime());

      const c = await newCase('sla_close');
      await sla.sweep(new Date(c.dueAt.getTime() + 60_000));
      const sv = await staffView(c.id);
      expect(sv.statusCategory).toBe('failure');
      expect(sv.history.map((h) => h.type)).toContain('expired');
      expect(sv.tasks!.every((x) => x.status !== 'open')).toBe(true);
    });
  });

  it('other tenants cannot see the case (TEN-02)', async () => {
    const c = (await startCase({ advisorId: advisor.membershipId }).expect(201)).body as CaseView;
    const platform = await createPlatformAdmin(t);
    const other = await createTenant(t, platform.token);
    await t.http.get(`/v1/cases/${c.id}`).set(as(other.adminToken, other.slug)).expect(404);
  });
});
