import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  createPlatformAdmin,
  createTenant,
  createUnit,
  login,
  nextMobile,
  PNG,
  registerStudent,
  setPasswordViaReset,
  startApp,
  sysPool,
  type TenantFixture,
  type TestApp,
} from './helpers.js';

interface Person {
  token: string;
  membershipId: string;
}

describe('thesis (phase 3, THS-01..12)', () => {
  let t: TestApp;
  let tf: TenantFixture;
  let roles: { id: string; key: string }[];
  let expert: Person;
  let advisorA: Person; // faculty of the student's faculty
  let advisorB: Person; // other faculty: not eligible
  let reviewerC: Person; // tenant-wide faculty
  let student: Person;
  let student2: Person;
  const pool = sysPool();
  const admin = () => as(tf.adminToken, tf.slug);
  const thesisData = (advisorId: string, title = 'بهینه‌سازی شبکه‌های عصبی کم‌مصرف') => ({
    title,
    degree: 'msc',
    field: 'هوش مصنوعی',
    researchType: 'applied',
    abstract: 'چکیده',
    advisorId,
  });

  async function person(kind: 'staff' | 'faculty', unitId: string, role: string, scopeType: string, scopeId?: string): Promise<Person> {
    const mobile = nextMobile();
    // staff kind: inviting faculty would also grant the base faculty role tenant-wide
    const inv = await t.http.post('/v1/admin/memberships/invite').set(admin()).send({ kind: kind === 'faculty' ? 'staff' : kind, fullName: `${role} ${mobile.slice(-3)}`, mobile, unitId }).expect(201);
    await t.http.post('/v1/admin/role-assignments').set(admin()).send({ membershipId: inv.body.membershipId, roleId: roles.find((r) => r.key === role)!.id, scopeType, scopeId }).expect(201);
    await setPasswordViaReset(t, mobile, 'Person#Pass123');
    return { token: await login(t, mobile, 'Person#Pass123'), membershipId: inv.body.membershipId };
  }
  async function newStudent(unitId: string): Promise<Person> {
    const s = await registerStudent(t, tf, unitId);
    await t.http.post(`/v1/admin/memberships/${s.membershipId}/approve`).set(admin()).send({}).expect(200);
    return { token: await login(t, s.mobile, s.password), membershipId: s.membershipId };
  }
  const upload = async (token: string) =>
    (await t.http.post('/v1/files').set(as(token, tf.slug)).field('purpose', 'case_attachment').attach('file', PNG, 'p.png').expect(201)).body.id as string;
  const openTask = async (caseId: string, token: string, step: string) => {
    const c = await t.http.get(`/v1/cases/${caseId}`).set(as(token, tf.slug)).expect(200);
    return c.body.tasks.find((x: { stepId: string; status: string }) => x.stepId === step && x.status === 'open').id as string;
  };
  const act = (caseId: string, taskId: string, token: string, body: Record<string, unknown>) =>
    t.http.post(`/v1/cases/${caseId}/tasks/${taskId}/actions`).set(as(token, tf.slug)).send(body);
  const step = async (caseId: string, token: string, stepId: string, body: Record<string, unknown>) =>
    act(caseId, await openTask(caseId, token, stepId), token, body).expect(200);

  beforeAll(async () => {
    t = await startApp();
    const platform = await createPlatformAdmin(t);
    tf = await createTenant(t, platform.token);
    const types = (await t.http.get('/v1/admin/unit-types').set(admin())).body as { id: string; key: string }[];
    const eng = (await createUnit(t, tf, 'دانشکده مهندسی')).id;
    const sci = (await createUnit(t, tf, 'دانشکده علوم')).id;
    const dept = (await createUnit(t, tf, 'گروه کامپیوتر', eng, types.find((x) => x.key === 'department')!.id)).id;
    roles = (await t.http.get('/v1/admin/roles').set(admin())).body;
    expert = await person('staff', eng, 'expert', 'tenant');
    advisorA = await person('faculty', eng, 'faculty', 'unit_tree', eng);
    advisorB = await person('faculty', sci, 'faculty', 'unit_tree', sci);
    reviewerC = await person('faculty', sci, 'faculty', 'tenant');
    student = await newStudent(dept);
    student2 = await newStudent(dept);
    await pool.query(`update memberships set profile = profile || '{"supervisionCapacity": 1}' where id = $1`, [advisorA.membershipId]);

    const w = await t.http.post('/v1/admin/workflow-templates/thesis-full/instantiate').set(admin()).send({ key: 'thesis', nameFa: 'پایان‌نامه', requestType: 'thesis' }).expect(201);
    const v = (await t.http.get(`/v1/admin/workflows/${w.body.id}`).set(admin())).body.versions[0].id;
    expect((await t.http.post(`/v1/admin/workflow-versions/${v}/validate`).set(admin())).body.issues).toEqual([]);
    await t.http.post(`/v1/admin/workflow-versions/${v}/publish`).set(admin()).expect(200);
  });
  afterAll(async () => {
    await pool.end();
    await t.close();
  });

  let caseId = '';

  it('advisor picker lists only eligible faculty with their load (THS-02/04)', async () => {
    const r = await t.http.get('/v1/cases/eligible-members?requestType=thesis&field=advisorId').set(as(student.token, tf.slug)).expect(200);
    const ids = r.body.map((x: { membership_id: string }) => x.membership_id);
    expect(ids).toContain(advisorA.membershipId);
    expect(ids).toContain(reviewerC.membershipId); // tenant-wide faculty covers every unit
    expect(ids).not.toContain(advisorB.membershipId);
    expect(r.body.find((x: { membership_id: string }) => x.membership_id === advisorA.membershipId)).toMatchObject({ load: 0, capacity: 1, full: false });
  });

  it('draft → submit; staff cannot see drafts; ineligible advisor refused (THS-01/02)', async () => {
    const d = await t.http.post('/v1/cases').set(as(student.token, tf.slug)).send({ requestType: 'thesis', title: 'پیش‌نویس', draft: true, data: { title: 'نیمه‌کاره' } }).expect(201);
    caseId = d.body.id;
    expect(d.body.statusCategory).toBe('draft');
    await t.http.get(`/v1/cases/${caseId}`).set(as(expert.token, tf.slug)).expect(404);
    // incomplete drafts cannot be submitted
    const incomplete = await t.http.post(`/v1/cases/${caseId}/submit`).set(as(student.token, tf.slug)).expect(400);
    expect(incomplete.body.error.details.fields.degree).toBe('required');

    const proposal = await upload(student.token);
    await t.http.patch(`/v1/cases/${caseId}/draft`).set(as(student.token, tf.slug)).send({ title: 'بهینه‌سازی شبکه‌های عصبی', data: { ...thesisData(advisorB.membershipId), proposal } }).expect(200);
    const bad = await t.http.post(`/v1/cases/${caseId}/submit`).set(as(student.token, tf.slug)).expect(400);
    expect(bad.body.error.code).toBe('MEMBER_NOT_ELIGIBLE');

    await t.http.patch(`/v1/cases/${caseId}/draft`).set(as(student.token, tf.slug)).send({ data: { ...thesisData(advisorA.membershipId), proposal } }).expect(200);
    const ok = await t.http.post(`/v1/cases/${caseId}/submit`).set(as(student.token, tf.slug)).expect(200);
    expect(ok.body.statusCategory).toBe('open');
    expect(ok.body.current.map((s: { stepId: string }) => s.stepId)).toEqual(['expert-check']);
    expect(ok.body.path.map((s: { stepId: string }) => s.stepId).slice(0, 3)).toEqual(['expert-check', 'advisor', 'final-approval']);
    expect(ok.body.attachments).toHaveLength(1);
  });

  it('one active thesis per student; advisor capacity is enforced (THS-04/05)', async () => {
    const p1 = await upload(student.token);
    const again = await t.http.post('/v1/cases').set(as(student.token, tf.slug)).send({ requestType: 'thesis', title: 'دوم', data: { ...thesisData(reviewerC.membershipId), proposal: p1 } }).expect(409);
    expect(again.body.error.code).toBe('CASE_LIMIT');
    const p2 = await upload(student2.token);
    const full = await t.http.post('/v1/cases').set(as(student2.token, tf.slug)).send({ requestType: 'thesis', title: 'x', data: { ...thesisData(advisorA.membershipId), proposal: p2 } }).expect(409);
    expect(full.body.error.code).toBe('MEMBER_CAPACITY_FULL');
  });

  it('targeted revision: only the requested fields, with a deadline; old values kept (THS-07)', async () => {
    await step(caseId, expert.token, 'expert-check', { action: 'return_for_fix', publicNote: 'عنوان دقیق‌تر شود', revision: { fields: ['title'], deadlineDays: 3 } });
    const mine = await t.http.get(`/v1/cases/${caseId}`).set(as(student.token, tf.slug)).expect(200);
    expect(mine.body.revision.fields).toEqual(['title']);
    expect(mine.body.revision.dueAt).toBeTruthy();
    const resubmit = (data: Record<string, unknown>) => act(caseId, mine.body.revisionTaskId, student.token, { action: 'resubmit', data });
    const blocked = await resubmit({ abstract: 'دیگر' }).expect(400);
    expect(blocked.body.error.details.fields).toEqual({ abstract: 'not_editable' });
    await resubmit({ title: 'بهینه‌سازی شبکه‌های عصبی کم‌مصرف روی لبه' }).expect(200);
    const sv = await t.http.get(`/v1/cases/${caseId}`).set(as(expert.token, tf.slug)).expect(200);
    expect(sv.body.history.find((h: { type: string }) => h.type === 'resubmitted').form.previous.title).toBe('بهینه‌سازی شبکه‌های عصبی کم‌مصرف');
  });

  it('proposal approved → record in progress; advisor sees the supervision', async () => {
    await step(caseId, expert.token, 'expert-check', { action: 'approve' });
    await step(caseId, advisorA.token, 'advisor', { action: 'approve' });
    await step(caseId, expert.token, 'final-approval', { action: 'approve' });
    await t.flush();
    const [th] = (await t.http.get('/v1/me/theses').set(as(student.token, tf.slug)).expect(200)).body;
    expect(th).toMatchObject({ status: 'in_progress', titleFa: 'بهینه‌سازی شبکه‌های عصبی کم‌مصرف روی لبه', degree: 'msc', advisor: { membershipId: advisorA.membershipId } });
    const sup = (await t.http.get('/v1/me/supervisions').set(as(advisorA.token, tf.slug)).expect(200)).body;
    expect(sup.find((x: { caseId: string }) => x.caseId === caseId).myRole).toBe('advisor');
  });

  it('final files on request, defense scheduling with reviewers, grade recorded (gate)', async () => {
    await step(caseId, expert.token, 'schedule-defense', { action: 'request_final_files', revision: { fields: ['finalFile', 'similarityReport'], deadlineDays: 14 } });
    const mine = await t.http.get(`/v1/cases/${caseId}`).set(as(student.token, tf.slug)).expect(200);
    const finalFile = await upload(student.token);
    const similarityReport = await upload(student.token);
    await act(caseId, mine.body.revisionTaskId, student.token, { action: 'resubmit', data: { finalFile, similarityReport } }).expect(200);

    // ineligible reviewer refused; then a valid schedule
    const scheduleTask = await openTask(caseId, expert.token, 'schedule-defense');
    const badRev = await act(caseId, scheduleTask, expert.token, { action: 'schedule', form: { reviewers: [expert.membershipId] } }).expect(400);
    expect(badRev.body.error.code).toBe('MEMBER_NOT_ELIGIBLE');
    const picker = await t.http.get(`/v1/cases/${caseId}/eligible-members?step=schedule-defense&field=reviewers`).set(as(expert.token, tf.slug)).expect(200);
    expect(picker.body.map((x: { membership_id: string }) => x.membership_id)).toContain(reviewerC.membershipId);
    await step(caseId, expert.token, 'schedule-defense', { action: 'schedule', form: { reviewers: [reviewerC.membershipId], defenseAt: '2026-12-01', defensePlace: 'تالار ابن‌سینا' } });
    await t.flush();
    let [th] = (await t.http.get('/v1/me/theses').set(as(student.token, tf.slug))).body;
    expect(th).toMatchObject({ status: 'defense_scheduled', defensePlace: 'تالار ابن‌سینا' });
    expect(th.reviewers).toHaveLength(1);

    await step(caseId, expert.token, 'defense', { action: 'pass', form: { grade: 18.5 } });
    await t.flush();
    [th] = (await t.http.get('/v1/me/theses').set(as(student.token, tf.slug))).body;
    expect(th).toMatchObject({ status: 'defended', grade: 18.5, gradeLabel: 'بسیار خوب' });
    expect((await t.http.get(`/v1/cases/${caseId}`).set(as(student.token, tf.slug))).body.statusCategory).toBe('success');
    const list = await t.http.get('/v1/admin/theses?status=defended').set(admin()).expect(200);
    expect(list.body.items.map((x: { caseId: string }) => x.caseId)).toContain(caseId);
  });

  it('advisor change moves the open advisor task (THS-09)', async () => {
    const p3 = await upload(student2.token);
    const c = await t.http.post('/v1/cases').set(as(student2.token, tf.slug)).send({ requestType: 'thesis', title: 'بهینه‌سازی شبکه‌های عصبی', data: { ...thesisData(advisorA.membershipId, 'بهینه‌سازی شبکه‌های عصبی'), proposal: p3 } }).expect(201);
    // THS-12: the reviewer gets a similar-title hint
    const sv = await t.http.get(`/v1/cases/${c.body.id}`).set(as(expert.token, tf.slug)).expect(200);
    expect(sv.body.similarTitles.map((x: { id: string }) => x.id)).toContain(caseId);
    await step(c.body.id, expert.token, 'expert-check', { action: 'approve' });
    await t.flush();
    const [rec] = (await t.http.get('/v1/me/theses').set(as(student2.token, tf.slug))).body;
    expect(rec).toBeUndefined(); // the record appears once the proposal is approved
    const url = `/v1/cases/${c.body.id}/advisor`;
    await t.http.post(url).set(as(student.token, tf.slug)).send({ membershipId: reviewerC.membershipId, reason: 'x' }).expect(403);
    await t.http.post(url).set(admin()).send({ membershipId: advisorB.membershipId, reason: 'x' }).expect(400); // not eligible for this unit
    const moved = await t.http.post(url).set(admin()).send({ membershipId: reviewerC.membershipId, reason: 'بازنشستگی استاد' }).expect(200);
    expect(moved.body.movedTasks).toBe(1);
    const cTasks = (await t.http.get('/v1/me/tasks').set(as(reviewerC.token, tf.slug))).body as { caseId: string }[];
    expect(cTasks.some((x) => x.caseId === c.body.id)).toBe(true);
    const aTasks = (await t.http.get('/v1/me/tasks').set(as(advisorA.token, tf.slug))).body as { caseId: string }[];
    expect(aTasks.some((x) => x.caseId === c.body.id)).toBe(false);
  });

  it('withdraw only where allowed (THS-10)', async () => {
    const d = await t.http.post('/v1/cases').set(as(student2.token, tf.slug)).send({ requestType: 'thesis', draft: true, data: {} }).expect(201);
    const w = await t.http.post(`/v1/cases/${d.body.id}/withdraw`).set(as(student2.token, tf.slug)).send({ reason: 'منصرف شدم' }).expect(200);
    expect(w.body.statusCategory).toBe('cancelled');
    // student2's open thesis waits on the advisor step, which allows withdrawal
    const mine = (await t.http.get('/v1/me/cases').set(as(student2.token, tf.slug))).body.items.find((x: { statusCategory: string }) => x.statusCategory === 'open');
    const view = await t.http.get(`/v1/cases/${mine.id}`).set(as(student2.token, tf.slug)).expect(200);
    expect(view.body.canWithdraw).toBe(true);
    await t.http.post(`/v1/cases/${mine.id}/withdraw`).set(as(student.token, tf.slug)).send({ reason: 'x' }).expect(404);
    await t.http.post(`/v1/cases/${mine.id}/withdraw`).set(as(student2.token, tf.slug)).send({ reason: 'تغییر موضوع' }).expect(200);
  });
});
