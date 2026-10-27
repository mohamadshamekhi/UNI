import { unzipSync, strFromU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createPlatformAdmin, createTenant, createUnit, login, nextMobile, registerStudent, setPasswordViaReset, startApp, sysPool, type TenantFixture, type TestApp } from './helpers.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';

interface Person {
  token: string;
  membershipId: string;
  userId: string;
}

const definition = {
  start: 'pay',
  steps: [
    { id: 'pay', type: 'payment', title: 'پرداخت هزینه دفاع', serviceKey: 'thesis.defense', deadlineDays: 3 },
    { id: 'check', type: 'human', title: 'بررسی کارشناس', assignee: { role: 'expert', scope: 'tenant' }, actions: ['ok'] },
    { id: 'done', type: 'end', title: 'پایان', outcome: 'success' },
    { id: 'unpaid', type: 'end', title: 'پرداخت نشد', outcome: 'failure' },
  ],
  transitions: [
    { from: 'pay', action: 'paid', to: 'check' },
    { from: 'pay', action: 'unpaid', to: 'unpaid' },
    { from: 'check', action: 'ok', to: 'done' },
  ],
};

describe('payments and reports (phase 6, PAY-01..13, AUD-08..10)', () => {
  let t: TestApp;
  let tf: TenantFixture;
  let roles: { id: string; key: string }[];
  let student: Person;
  let finance: Person;
  let expert: Person;
  let eng = '';
  const pool = sysPool();
  const admin = () => as(tf.adminToken, tf.slug);

  async function staff(role: string): Promise<Person> {
    const mobile = nextMobile();
    const inv = await t.http.post('/v1/admin/memberships/invite').set(admin()).send({ kind: 'staff', fullName: 'کارمند', mobile, unitId: eng }).expect(201);
    await t.http.post('/v1/admin/role-assignments').set(admin()).send({ membershipId: inv.body.membershipId, roleId: roles.find((r) => r.key === role)!.id, scopeType: 'tenant' }).expect(201);
    await setPasswordViaReset(t, mobile, 'Person#Pass123');
    const userId = (await pool.query('select user_id from memberships where id = $1', [inv.body.membershipId])).rows[0].user_id;
    return { token: await login(t, mobile, 'Person#Pass123'), membershipId: inv.body.membershipId, userId };
  }

  const caseRow = async (id: string) => (await pool.query('select status_category, current_steps from cases where id = $1', [id])).rows[0] as { status_category: string; current_steps: string[] };
  const requestFor = async (refId: string) => (await pool.query('select * from payment_requests where ref_id = $1', [refId])).rows[0] as { id: string; amount: string; status: string } | undefined;
  const bank = (authority: string, outcome: string) => t.http.get(`/v1/payment-sandbox/${authority}/decide?outcome=${outcome}`);
  const authorityOf = (url: string) => url.split('/').pop()!;

  beforeAll(async () => {
    t = await startApp();
    const platform = await createPlatformAdmin(t);
    tf = await createTenant(t, platform.token);
    roles = (await t.http.get('/v1/admin/roles').set(admin())).body;
    eng = (await createUnit(t, tf, 'دانشکده مهندسی')).id;
    finance = await staff('finance_officer');
    expert = await staff('expert');
    const s = await registerStudent(t, tf, eng);
    await t.http.post(`/v1/admin/memberships/${s.membershipId}/approve`).set(admin()).send({}).expect(200);
    student = { token: await login(t, s.mobile, s.password), membershipId: s.membershipId, userId: s.userId };

    const w = await t.http.post('/v1/admin/workflows').set(admin()).send({ key: 'defense-fee', nameFa: 'دفاع با هزینه', requestType: 'defense_fee' }).expect(201);
    const v = (await t.http.get(`/v1/admin/workflows/${w.body.id}`).set(admin())).body.versions[0].id;
    await t.http.patch(`/v1/admin/workflow-versions/${v}`).set(admin()).send({ definition }).expect(200);
    expect((await t.http.post(`/v1/admin/workflow-versions/${v}/validate`).set(admin()).expect(200)).body.issues).toEqual([]);
    await t.http.post(`/v1/admin/workflow-versions/${v}/publish`).set(admin()).expect(200);
  });
  afterAll(async () => {
    await pool.end();
    await t.close();
  });

  describe('payments', () => {
    let caseId = '';
    let requestId = '';

    it('only finance staff manage tariffs; tariffs are versioned (PAY-10)', async () => {
      await t.http.post('/v1/admin/fees').set(as(student.token, tf.slug)).send({ serviceKey: 'thesis.defense', title: 'هزینه دفاع', amount: 5_000_000 }).expect(403);
      const f = await t.http.post('/v1/admin/fees').set(as(finance.token, tf.slug)).send({ serviceKey: 'thesis.defense', title: 'هزینه دفاع', amount: 5_000_000 }).expect(201);
      expect(f.body.version).toBe(1);
    });

    it('a workflow payment step creates the request with the server-side amount and waits (PAY-02/08)', async () => {
      const c = await t.http.post('/v1/cases').set(as(student.token, tf.slug)).send({ requestType: 'defense_fee' }).expect(201);
      caseId = c.body.id;
      await t.flush();
      const r = await requestFor(caseId);
      expect(r).toBeDefined();
      expect(Number(r!.amount)).toBe(5_000_000);
      requestId = r!.id;
      expect((await caseRow(caseId)).current_steps).toEqual(['pay']);
      // a later tariff change does not touch the existing request
      await t.http.post('/v1/admin/fees').set(as(finance.token, tf.slug)).send({ serviceKey: 'thesis.defense', title: 'هزینه دفاع', amount: 7_000_000 }).expect(201);
      const mine = await t.http.get('/v1/me/payments').set(as(student.token, tf.slug)).expect(200);
      expect(mine.body.find((x: { id: string }) => x.id === requestId).amount).toBe(5_000_000);
      expect((await pool.query(`select count(*)::int as n from notifications where user_id = $1 and event = 'payment.requested'`, [student.userId])).rows[0].n).toBe(1);
    });

    it('only the payer can start; a failed attempt allows a retry', async () => {
      await t.http.post(`/v1/payments/${requestId}/start`).set(as(expert.token, tf.slug)).expect(404);
      const a = await t.http.post(`/v1/payments/${requestId}/start`).set(as(student.token, tf.slug)).expect(200);
      expect(a.body.redirectUrl).toMatch(/payment-sandbox\/SBX/);
      await bank(authorityOf(a.body.redirectUrl), 'fail').expect(303);
      const v = await t.http.post(`/v1/payments/${requestId}/verify`).set({ 'x-tenant': tf.slug }).send({ authority: authorityOf(a.body.redirectUrl) }).expect(200);
      expect(v.body.status).toBe('failed');
      expect((await caseRow(caseId)).current_steps).toEqual(['pay']);
      const d = await t.http.get(`/v1/payments/${requestId}`).set(as(student.token, tf.slug)).expect(200);
      expect(d.body.attempts[0]).toMatchObject({ status: 'failed', errorCode: 'DECLINED' });
      expect(d.body.attempts[0].authority).toBeUndefined(); // gateway details are for staff only
    });

    it('GATE: repeated start / callback with the same key → one transaction, one receipt, one move (PAY-05/06)', async () => {
      const key = 'retry-key-0001';
      const a = await t.http.post(`/v1/payments/${requestId}/start`).set({ ...as(student.token, tf.slug), 'idempotency-key': key }).expect(200);
      const b = await t.http.post(`/v1/payments/${requestId}/start`).set({ ...as(student.token, tf.slug), 'idempotency-key': key }).expect(200);
      expect(b.body.transactionId).toBe(a.body.transactionId);
      const authority = authorityOf(a.body.redirectUrl);
      const back = await bank(authority, 'success').expect(303);
      expect(back.headers.location).toContain(`/payments/${requestId}/return?authority=${authority}&status=OK`);
      // the bank's callback arrives several times, concurrently
      const results = await Promise.all([1, 2, 3].map(() => t.http.post(`/v1/payments/${requestId}/verify`).set({ 'x-tenant': tf.slug }).send({ authority })));
      for (const r of results) expect(r.body.status).toBe('succeeded');
      await t.flush();
      const counts = (
        await pool.query(
          `select (select count(*)::int from payment_transactions where request_id = $1 and status = 'succeeded') as tx,
                  (select count(*)::int from payment_receipts where request_id = $1) as receipts,
                  (select count(*)::int from case_events where case_id = $2 and action = 'paid') as moves,
                  (select count(*)::int from notifications where event = 'payment.succeeded' and user_id = $3) as notices`,
          [requestId, caseId, student.userId],
        )
      ).rows[0];
      expect(counts).toEqual({ tx: 1, receipts: 1, moves: 1, notices: 1 });
      expect((await caseRow(caseId)).current_steps).toEqual(['check']);
      const receipt = await t.http.get(`/v1/payments/${requestId}/receipt`).set(as(student.token, tf.slug)).expect(200);
      expect(receipt.body).toMatchObject({ amount: 5_000_000, receiptNo: expect.stringMatching(/^R14\d\d-\d{6}$/) });
      await t.http.post(`/v1/payments/${requestId}/start`).set(as(student.token, tf.slug)).expect(409);
    });

    it('the daily reconciliation balances (PAY-07)', async () => {
      const r = await t.http.get(`/v1/admin/payments/reconciliation?day=${new Date().toISOString()}`).set(as(finance.token, tf.slug)).expect(200);
      expect(r.body).toMatchObject({ balanced: true, mismatched: 0 });
      expect(r.body.requestTotal).toBeGreaterThanOrEqual(5_000_000);
    });

    it('an unanswered attempt is re-verified, then sent to review and settled by finance (PAY-07/13)', async () => {
      const c = await t.http.post('/v1/cases').set(as(student.token, tf.slug)).send({ requestType: 'defense_fee' }).expect(201);
      await t.flush();
      const r = (await requestFor(c.body.id))!;
      const a = await t.http.post(`/v1/payments/${r.id}/start`).set(as(student.token, tf.slug)).expect(200);
      await bank(authorityOf(a.body.redirectUrl), 'hang').expect(200);
      const payments = t.app.get(PaymentsService);
      await payments.reconcile(new Date(Date.now() + 20 * 60_000)); // still unknown
      expect((await requestFor(c.body.id))!.status).toBe('pending');
      await payments.reconcile(new Date(Date.now() + 25 * 3_600_000));
      expect((await requestFor(c.body.id))!.status).toBe('review');
      await t.flush();
      expect((await pool.query(`select count(*)::int as n from notifications where user_id = $1 and event = 'payment.review'`, [finance.userId])).rows[0].n).toBeGreaterThan(0);

      await t.http.post(`/v1/admin/payments/${r.id}/review`).set(as(expert.token, tf.slug)).send({ outcome: 'succeeded', reason: 'x' }).expect(403);
      const d = await t.http.post(`/v1/admin/payments/${r.id}/review`).set(as(finance.token, tf.slug)).send({ outcome: 'succeeded', reason: 'تأیید با گزارش بانک' }).expect(200);
      expect(d.body.status).toBe('succeeded');
      await t.flush();
      expect((await caseRow(c.body.id)).current_steps).toEqual(['check']);
    });

    it('an expired request closes and the case takes its unpaid path', async () => {
      const c = await t.http.post('/v1/cases').set(as(student.token, tf.slug)).send({ requestType: 'defense_fee' }).expect(201);
      await t.flush();
      await t.app.get(PaymentsService).reconcile(new Date(Date.now() + 4 * 86_400_000));
      expect((await requestFor(c.body.id))!.status).toBe('cancelled');
      await t.flush();
      expect((await caseRow(c.body.id)).status_category).toBe('failure');
    });

    it('gateway secrets are stored encrypted and never returned (PAY-03/04)', async () => {
      const g = await t.http.put('/v1/admin/payment-gateway').set(as(finance.token, tf.slug)).send({ adapter: 'sandbox', merchantId: 'M-1', secret: 'super-secret-value', active: true }).expect(200);
      expect(JSON.stringify(g.body)).not.toContain('super-secret-value');
      expect(g.body.config).toMatchObject({ adapter: 'sandbox', hasSecret: true });
      const raw = (await pool.query('select secret_encrypted from gateway_configs where tenant_id = $1', [tf.id])).rows[0].secret_encrypted as string;
      expect(raw).not.toContain('super-secret-value');
      await t.http.put('/v1/admin/payment-gateway').set(as(finance.token, tf.slug)).send({ adapter: 'no-such-bank', active: true }).expect(400);
    });
  });

  describe('paid events', () => {
    it('a paid registration holds its seat until paid, then is confirmed', async () => {
      const mobile = nextMobile();
      const inv = await t.http.post('/v1/admin/memberships/invite').set(admin()).send({ kind: 'staff', fullName: 'برگزارکننده', mobile, unitId: eng }).expect(201);
      await t.http.post('/v1/admin/role-assignments').set(admin()).send({ membershipId: inv.body.membershipId, roleId: roles.find((r) => r.key === 'event_manager')!.id, scopeType: 'tenant' }).expect(201);
      await setPasswordViaReset(t, mobile, 'Person#Pass123');
      const org = await login(t, mobile, 'Person#Pass123');
      const start = new Date(Date.now() + 5 * 86_400_000);
      const e = await t.http
        .post('/v1/admin/events')
        .set(as(org, tf.slug))
        .send({ title: 'کارگاه پولی', startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString(), visibility: 'own_tenant', registrationRule: { members: true }, capacity: 1, waitlist: true, feeAmount: 2_000_000 })
        .expect(201);
      await t.http.post(`/v1/admin/events/${e.body.id}/status`).set(as(org, tf.slug)).send({ status: 'registration_open' }).expect(200);
      const reg = await t.http.post(`/v1/events/${e.body.id}/registrations`).set(as(student.token, tf.slug)).send({}).expect(201);
      expect(reg.body).toMatchObject({ status: 'awaiting_payment', paymentId: expect.any(String) });
      // the seat is held: the next person is wait-listed
      const other = await t.http.post(`/v1/events/${e.body.id}/registrations`).set(as(expert.token, tf.slug)).send({}).expect(201);
      expect(other.body.status).toBe('waitlisted');
      const a = await t.http.post(`/v1/payments/${reg.body.paymentId}/start`).set(as(student.token, tf.slug)).expect(200);
      await bank(authorityOf(a.body.redirectUrl), 'success').expect(303);
      await t.http.post(`/v1/payments/${reg.body.paymentId}/verify`).set({ 'x-tenant': tf.slug }).send({ authority: authorityOf(a.body.redirectUrl) }).expect(200);
      await t.flush();
      const d = await t.http.get(`/v1/events/${e.body.id}`).set(as(student.token, tf.slug)).expect(200);
      expect(d.body.mine.status).toBe('registered');
      expect(Number((await pool.query('select amount from payment_requests where id = $1', [reg.body.paymentId])).rows[0].amount)).toBe(2_000_000);
    });
  });

  describe('reports', () => {
    it('report access follows report.view; finance needs payment.view (AUD-08)', async () => {
      await t.http.get('/v1/admin/reports/cases_by_status').set(as(student.token, tf.slug)).expect(403);
      const r = await t.http.get('/v1/admin/reports/cases_by_status').set(as(expert.token, tf.slug)).expect(200);
      expect(r.body.rows.find((x: { requestType: string }) => x.requestType === 'defense_fee')).toBeDefined();
      await t.http.get('/v1/admin/reports/finance').set(as(expert.token, tf.slug)).expect(403);
      const f = await t.http.get('/v1/admin/reports/finance').set(as(finance.token, tf.slug)).expect(200);
      const paid = f.body.rows.find((x: { serviceKey: string; statusKey: string }) => x.serviceKey === 'thesis.defense' && x.statusKey === 'succeeded');
      expect(paid.total).toBe(12_000_000); // 5M at the old tariff + 7M after the new version
      for (const key of ['open_tasks', 'step_durations', 'overdue', 'memberships', 'papers', 'news', 'events']) {
        await t.http.get(`/v1/admin/reports/${key}`).set(admin()).expect(200);
      }
      const s = await t.http.get('/v1/admin/reports/summary').set(admin()).expect(200);
      expect(s.body.openCases).toBeGreaterThan(0);
    });

    it('exports need report.export and are audited (AUD-09)', async () => {
      await t.http.get('/v1/admin/reports/memberships/export?format=csv').set(as(expert.token, tf.slug)).expect(403);
      const csv = await t.http.get('/v1/admin/reports/memberships/export?format=csv').set(as(finance.token, tf.slug)).expect(200);
      expect(csv.text.charCodeAt(0)).toBe(0xfeff);
      const x = await t.http
        .get('/v1/admin/reports/finance/export?format=xlsx')
        .set(as(finance.token, tf.slug))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const sheet = strFromU8(unzipSync(new Uint8Array(x.body as Buffer))['xl/worksheets/sheet1.xml']!);
      expect(sheet).toContain('مبلغ (ریال)');
      const audit = await pool.query(`select count(*)::int as n from audit_logs where tenant_id = $1 and action = 'report.exported'`, [tf.id]);
      expect(audit.rows[0].n).toBe(2);
    });
  });
});
