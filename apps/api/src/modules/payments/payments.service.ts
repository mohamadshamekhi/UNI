import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { decryptSecret, encryptSecret } from '../../common/util/totp.js';
import { ENV, type Env } from '../../config/env.js';
import { DbService, type Executor } from '../../database/db.service.js';
import {
  feeSchedules,
  gatewayConfigs,
  memberships,
  paymentEvents,
  paymentReceipts,
  paymentRequests,
  paymentTransactions,
  tenants,
  users,
  type PaymentRefType,
  type PaymentStatus,
} from '../../database/schema.js';
import { RedisService } from '../../infra/redis.js';
import { AclService } from '../acl/acl.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { WorkflowEngine } from '../workflow/engine.service.js';
import { GatewayRegistry, type GatewayAdapter, type GatewayConfig } from './gateway.js';

type RequestRow = typeof paymentRequests.$inferSelect;
type TxRow = typeof paymentTransactions.$inferSelect;

const persianYear = (d: Date) => new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric' }).formatToParts(d).find((p) => p.type === 'year')!.value;
/** attempts older than this without a final answer are re-verified by reconciliation (PAY-07) */
const STALE_MS = 15 * 60_000;
/** after this long an unanswered attempt needs a finance officer */
const REVIEW_AFTER_MS = 24 * 3_600_000;
const PAYABLE: PaymentStatus[] = ['created', 'pending', 'failed'];

export interface NewRequest {
  serviceKey: string;
  title: string;
  payerUserId: string;
  payerMembershipId?: string | null;
  refType: PaymentRefType;
  refId?: string | null;
  refStepId?: string | null;
  expiresAt?: Date | null;
  idempotencyKey: string;
}

/**
 * Payment module (section 12). Other modules only create requests and listen for
 * `payment.succeeded` / `payment.cancelled` (PAY-01). The amount always comes from the tariff on the
 * server (PAY-02); the bank callback is a hint and `verify` decides (PAY-05); every state change is
 * idempotent under a row lock (PAY-06).
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger('Payments');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
    private readonly acl: AclService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly redis: RedisService,
    private readonly gateways: GatewayRegistry,
    private readonly engine: WorkflowEngine,
  ) {}

  onModuleInit() {
    // PAY-08: a workflow payment step asks for a request; the result moves the case on
    this.outbox.on('workflow.payment', async ({ tenantId, payload }) => {
      if (!tenantId) return;
      await this.db.background(tenantId, 'workflow.payment', async (tx) => {
        const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, payload.applicantMembershipId as string));
        if (!m) return;
        await this.createRequest(tx, tenantId, {
          serviceKey: payload.serviceKey as string,
          title: payload.title as string,
          payerUserId: m.userId,
          payerMembershipId: payload.applicantMembershipId as string,
          refType: 'case',
          refId: payload.caseId as string,
          refStepId: payload.stepId as string,
          expiresAt: new Date(Date.now() + (payload.deadlineDays as number) * 86_400_000),
          idempotencyKey: `case:${payload.caseId as string}:${payload.stepId as string}`,
        });
      });
    });
    this.outbox.on('payment.succeeded', ({ tenantId, payload }) => this.resumeRef(tenantId, payload, 'paid'));
    this.outbox.on('payment.cancelled', ({ tenantId, payload }) => this.resumeRef(tenantId, payload, 'unpaid'));
  }

  private async resumeRef(tenantId: string | null, payload: Record<string, unknown>, outcome: 'paid' | 'unpaid') {
    if (!tenantId || payload.refType !== 'case' || !payload.refId || !payload.refStepId) return;
    await this.db.background(tenantId, `payment.${outcome}`, (tx) => this.engine.resumePayment(tx, payload.refId as string, payload.refStepId as string, outcome));
  }

  // ── tariffs (PAY-10) ─────────────────────────────────────────────────────

  /** The tariff in force at `at`: latest version whose effective date has passed. */
  async currentFee(tx: Executor, serviceKey: string, at = new Date()) {
    const [f] = await tx
      .select()
      .from(feeSchedules)
      .where(and(eq(feeSchedules.serviceKey, serviceKey), lte(feeSchedules.effectiveFrom, at)))
      .orderBy(desc(feeSchedules.effectiveFrom), desc(feeSchedules.version))
      .limit(1);
    return f ?? null;
  }

  async fees() {
    await this.acl.assert('payment.manage');
    return this.db.run((tx) => tx.select().from(feeSchedules).orderBy(asc(feeSchedules.serviceKey), desc(feeSchedules.version)));
  }

  /** A new version; requests already created keep the amount they were created with. */
  async setFee(input: { serviceKey: string; title: string; amount: number; effectiveFrom?: string }) {
    await this.acl.assert('payment.manage');
    const ctx = requestContext.get();
    const fee = await this.db.run(async (tx) => {
      const [{ v }] = (await tx.execute<{ v: number }>(sql`select coalesce(max(version), 0)::int + 1 as v from fee_schedules where service_key = ${input.serviceKey}`)).rows as [{ v: number }];
      const [f] = await tx
        .insert(feeSchedules)
        .values({
          tenantId: ctx.tenant!.id,
          serviceKey: input.serviceKey,
          title: input.title.trim(),
          amount: input.amount,
          effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(),
          version: v,
          createdBy: ctx.userId,
        })
        .returning();
      return f!;
    });
    await this.audit.record({ action: 'payment.fee.set', targetType: 'fee_schedule', targetId: fee.id, after: { serviceKey: fee.serviceKey, amount: fee.amount, version: fee.version, effectiveFrom: fee.effectiveFrom } });
    return fee;
  }

  // ── gateway configuration (PAY-03) ───────────────────────────────────────

  async gatewayConfig() {
    await this.acl.assert('payment.manage');
    const [c] = await this.db.run((tx) => tx.select().from(gatewayConfigs).limit(1));
    return {
      adapters: this.gateways.list(),
      config: c ? { adapter: c.adapter, merchantId: c.merchantId, hasSecret: !!c.secretEncrypted, active: c.active, updatedAt: c.updatedAt } : null,
    };
  }

  async setGatewayConfig(input: { adapter: string; merchantId?: string; secret?: string; active: boolean }) {
    await this.acl.assert('payment.manage');
    if (!this.gateways.get(input.adapter)) throw new AppError('VALIDATION_FAILED', { field: 'adapter' });
    const ctx = requestContext.get();
    const values = {
      tenantId: ctx.tenant!.id,
      adapter: input.adapter,
      merchantId: input.merchantId?.trim() || null,
      active: input.active,
      updatedBy: ctx.userId,
      updatedAt: new Date(),
      ...(input.secret ? { secretEncrypted: encryptSecret(this.env.DATA_ENC_KEY, input.secret) } : {}),
    };
    await this.db.run((tx) => tx.insert(gatewayConfigs).values(values).onConflictDoUpdate({ target: gatewayConfigs.tenantId, set: values }));
    // the secret itself is never written to the audit log
    await this.audit.record({ action: 'payment.gateway.updated', targetType: 'tenant', targetId: ctx.tenant!.id, after: { adapter: input.adapter, merchantId: values.merchantId, active: input.active, secretChanged: !!input.secret } });
    return this.gatewayConfig();
  }

  /** Active adapter of the tenant; development falls back to the sandbox when nothing is configured. */
  private async adapterFor(tx: Executor): Promise<{ adapter: GatewayAdapter; config: GatewayConfig }> {
    const [c] = await tx.select().from(gatewayConfigs).limit(1);
    if (c?.active) {
      const adapter = this.gateways.get(c.adapter);
      if (adapter) return { adapter, config: { merchantId: c.merchantId, secret: c.secretEncrypted ? decryptSecret(this.env.DATA_ENC_KEY, c.secretEncrypted) : null } };
    }
    const sandbox = !c && this.gateways.get('sandbox');
    if (sandbox) return { adapter: sandbox, config: { merchantId: null, secret: null } };
    throw new AppError('GATEWAY_UNAVAILABLE');
  }

  // ── requests ─────────────────────────────────────────────────────────────

  /** Creates (or returns the existing) request for an idempotency key. Runs in the tenant's transaction. */
  async createRequest(tx: Executor, tenantId: string, input: NewRequest): Promise<RequestRow> {
    const [existing] = await tx.select().from(paymentRequests).where(eq(paymentRequests.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) return existing;
    const fee = await this.currentFee(tx, input.serviceKey);
    if (!fee) throw new AppError('FEE_NOT_DEFINED', { serviceKey: input.serviceKey });
    const now = new Date();
    const [{ n }] = (await tx.execute<{ n: string }>(sql`select nextval('payment_tracking_seq')::text as n`)).rows as [{ n: string }];
    const [r] = await tx
      .insert(paymentRequests)
      .values({
        tenantId,
        trackingCode: `PAY-${persianYear(now)}-${n.padStart(6, '0')}`,
        serviceKey: input.serviceKey,
        feeScheduleId: fee.id,
        title: input.title || fee.title,
        amount: fee.amount,
        payerUserId: input.payerUserId,
        payerMembershipId: input.payerMembershipId ?? null,
        refType: input.refType,
        refId: input.refId ?? null,
        refStepId: input.refStepId ?? null,
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!r) {
      const [again] = await tx.select().from(paymentRequests).where(eq(paymentRequests.idempotencyKey, input.idempotencyKey)).limit(1);
      return again!;
    }
    await this.event(tx, r, 'created', { amount: r.amount, feeVersion: fee.version });
    await this.outbox.emit('payment.requested', { requestId: r.id }, `payment.requested:${r.id}`, tenantId, tx);
    return r;
  }

  private async event(tx: Executor, r: Pick<RequestRow, 'id' | 'tenantId'>, type: string, data: Record<string, unknown> = {}, actorUserId: string | null = null) {
    await tx.insert(paymentEvents).values({ tenantId: r.tenantId, requestId: r.id, type, data, actorUserId } as typeof paymentEvents.$inferInsert);
  }

  private async load(tx: Executor, id: string, lock = false): Promise<RequestRow> {
    const q = tx.select().from(paymentRequests).where(eq(paymentRequests.id, id)).limit(1);
    const [r] = lock ? await q.for('update') : await q;
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }

  /** Payer, or staff with payment.view, may see a request. */
  private async assertSee(r: RequestRow) {
    const ctx = requestContext.get();
    if (r.payerUserId === ctx.userId) return;
    if (!(await this.acl.has('payment.view'))) throw new AppError('NOT_FOUND');
  }

  async mine() {
    const ctx = requestContext.get();
    if (!ctx.userId) throw new AppError('UNAUTHENTICATED');
    return this.db.run((tx) =>
      tx
        .select({
          id: paymentRequests.id,
          trackingCode: paymentRequests.trackingCode,
          title: paymentRequests.title,
          amount: paymentRequests.amount,
          status: paymentRequests.status,
          refType: paymentRequests.refType,
          refId: paymentRequests.refId,
          expiresAt: paymentRequests.expiresAt,
          paidAt: paymentRequests.paidAt,
          createdAt: paymentRequests.createdAt,
        })
        .from(paymentRequests)
        .where(eq(paymentRequests.payerUserId, ctx.userId!))
        .orderBy(desc(paymentRequests.createdAt))
        .limit(200),
    );
  }

  /** One request with its attempts (no gateway payloads for the payer), receipt and history. */
  async get(id: string) {
    return this.db.run(async (tx) => {
      const r = await this.load(tx, id);
      await this.assertSee(r);
      const staff = r.payerUserId !== requestContext.get().userId;
      const attempts = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.requestId, id)).orderBy(desc(paymentTransactions.startedAt));
      const [receipt] = await tx.select().from(paymentReceipts).where(eq(paymentReceipts.requestId, id)).limit(1);
      const history = await tx
        .select({ type: paymentEvents.type, data: paymentEvents.data, occurredAt: paymentEvents.occurredAt, actor: users.fullName })
        .from(paymentEvents)
        .leftJoin(users, eq(users.id, paymentEvents.actorUserId))
        .where(eq(paymentEvents.requestId, id))
        .orderBy(asc(paymentEvents.occurredAt));
      const [payer] = await tx.select({ fullName: users.fullName, mobile: users.mobile }).from(users).where(eq(users.id, r.payerUserId));
      const { idempotencyKey: _k, lockVersion: _l, ...rest } = r;
      return {
        ...rest,
        payer: payer ?? null,
        payable: PAYABLE.includes(r.status) && (!r.expiresAt || r.expiresAt > new Date()),
        attempts: attempts.map((a) => ({
          id: a.id,
          adapter: a.adapter,
          status: a.status,
          referenceId: a.referenceId,
          errorCode: a.errorCode,
          errorMessage: a.errorMessage,
          startedAt: a.startedAt,
          finishedAt: a.finishedAt,
          ...(staff ? { authority: a.authority, verifyPayload: a.verifyPayload } : {}),
        })),
        receipt: receipt ?? null,
        history,
      };
    });
  }

  /**
   * Starts a bank attempt and returns where to send the payer. A repeated call with the same
   * `Idempotency-Key` returns the first answer instead of opening a second transaction.
   */
  async start(id: string, idempotencyKey?: string) {
    const ctx = requestContext.get();
    const cacheKey = idempotencyKey ? `paystart:${ctx.tenant!.id}:${id}:${idempotencyKey}` : null;
    if (cacheKey) {
      const cached = await this.redis.client.get(cacheKey);
      if (cached) return JSON.parse(cached) as { transactionId: string; redirectUrl: string };
    }
    const out = await this.db.run(async (tx) => {
      const r = await this.load(tx, id, true);
      if (r.payerUserId !== ctx.userId) throw new AppError('NOT_FOUND');
      if (!PAYABLE.includes(r.status)) throw new AppError('PAYMENT_NOT_PAYABLE', { status: r.status });
      if (r.expiresAt && r.expiresAt <= new Date()) throw new AppError('PAYMENT_EXPIRED');
      const { adapter, config } = await this.adapterFor(tx);
      const callbackUrl = `${this.env.PORTAL_URL}/${ctx.tenant!.slug}/payments/${r.id}/return`;
      const g = await adapter.start({ amount: r.amount, description: `${r.title} — ${r.trackingCode}`, callbackUrl, config });
      const [t] = await tx.insert(paymentTransactions).values({ tenantId: r.tenantId, requestId: r.id, adapter: adapter.key, amount: r.amount, authority: g.authority }).returning();
      await tx.update(paymentRequests).set({ status: 'pending', updatedAt: new Date(), lockVersion: sql`${paymentRequests.lockVersion} + 1` }).where(eq(paymentRequests.id, r.id));
      await this.event(tx, r, 'attempt_started', { transactionId: t!.id, adapter: adapter.key }, ctx.userId);
      return { transactionId: t!.id, redirectUrl: g.redirectUrl };
    });
    if (cacheKey) await this.redis.client.set(cacheKey, JSON.stringify(out), 'EX', 3600);
    return out;
  }

  /**
   * The payer's browser came back from the bank. The query string is only a hint: the result is
   * decided by `verify` with the gateway. Safe to call any number of times (PAY-06).
   */
  async verifyReturn(id: string, authority: string) {
    const tenantId = requestContext.get().tenant!.id;
    await this.db.withTenant(tenantId, (tx) => this.settle(tx, id, authority));
    return this.db.withTenant(tenantId, async (tx) => {
      const r = await this.load(tx, id);
      const [receipt] = await tx.select({ receiptNo: paymentReceipts.receiptNo }).from(paymentReceipts).where(eq(paymentReceipts.requestId, id));
      return { id: r.id, status: r.status, trackingCode: r.trackingCode, amount: r.amount, title: r.title, receiptNo: receipt?.receiptNo ?? null };
    });
  }

  /** Verifies one attempt with the gateway and applies the result atomically. */
  private async settle(tx: Executor, requestId: string, authority: string): Promise<TxRow | null> {
    const r = await this.load(tx, requestId, true);
    const [t] = await tx
      .select()
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.requestId, r.id), eq(paymentTransactions.authority, authority)))
      .for('update')
      .limit(1);
    if (!t) throw new AppError('NOT_FOUND');
    if (t.status === 'succeeded' || t.status === 'failed' || t.status === 'cancelled') return t; // already settled
    const adapter = this.gateways.get(t.adapter);
    if (!adapter) throw new AppError('GATEWAY_UNAVAILABLE');
    const { config } = await this.adapterFor(tx).catch(() => ({ config: { merchantId: null, secret: null } as GatewayConfig }));
    const v = await adapter.verify({ authority, amount: t.amount, config }).catch((err: Error) => ({ status: 'unknown' as const, errorCode: 'VERIFY_ERROR', errorMessage: err.message, payload: {} }));
    const now = new Date();

    if (v.status === 'unknown') {
      await tx.update(paymentTransactions).set({ status: 'unknown', checkedAt: now, errorCode: v.errorCode ?? null, errorMessage: v.errorMessage ?? null }).where(eq(paymentTransactions.id, t.id));
      return t;
    }
    if (v.status === 'failed') {
      await tx
        .update(paymentTransactions)
        .set({ status: 'failed', finishedAt: now, checkedAt: now, errorCode: v.errorCode ?? null, errorMessage: v.errorMessage ?? null, verifyPayload: v.payload })
        .where(eq(paymentTransactions.id, t.id));
      if (r.status === 'pending') await tx.update(paymentRequests).set({ status: 'failed', updatedAt: now }).where(eq(paymentRequests.id, r.id));
      await this.event(tx, r, 'attempt_failed', { transactionId: t.id, errorCode: v.errorCode });
      return t;
    }
    // PAY-05: the amount the gateway confirms must equal the request
    if (v.amount !== undefined && v.amount !== r.amount) {
      await tx
        .update(paymentTransactions)
        .set({ status: 'unknown', checkedAt: now, errorCode: 'AMOUNT_MISMATCH', errorMessage: `gateway ${v.amount} ≠ request ${r.amount}`, verifyPayload: v.payload })
        .where(eq(paymentTransactions.id, t.id));
      await tx.update(paymentRequests).set({ status: 'review', updatedAt: now }).where(eq(paymentRequests.id, r.id));
      await this.event(tx, r, 'review', { transactionId: t.id, reason: 'amount_mismatch' });
      await this.outbox.emit('payment.review', { requestId: r.id }, `payment.review:${r.id}:${t.id}`, r.tenantId, tx);
      return t;
    }
    await tx
      .update(paymentTransactions)
      .set({ status: 'succeeded', referenceId: v.referenceId ?? null, finishedAt: now, checkedAt: now, verifyPayload: v.payload })
      .where(eq(paymentTransactions.id, t.id));
    await this.succeed(tx, r, t.id, v.referenceId ?? null, null);
    return t;
  }

  /** Marks the request paid once: receipt + domain event (unique receipt per request). */
  private async succeed(tx: Executor, r: RequestRow, transactionId: string, referenceId: string | null, actorUserId: string | null) {
    if (r.status === 'succeeded') return;
    const now = new Date();
    await tx.update(paymentRequests).set({ status: 'succeeded', paidAt: now, updatedAt: now, lockVersion: sql`${paymentRequests.lockVersion} + 1` }).where(eq(paymentRequests.id, r.id));
    await tx
      .insert(paymentReceipts)
      .values({ tenantId: r.tenantId, requestId: r.id, transactionId, receiptNo: `R${r.trackingCode.slice(4)}`, amount: r.amount, referenceId })
      .onConflictDoNothing();
    await this.event(tx, r, 'succeeded', { transactionId, referenceId }, actorUserId);
    await this.outbox.emit('payment.succeeded', { requestId: r.id, refType: r.refType, refId: r.refId, refStepId: r.refStepId }, `payment.succeeded:${r.id}`, r.tenantId, tx);
  }

  /** The payer gives up (or a deadline passes): the referencing module takes its "unpaid" path. */
  async cancel(id: string) {
    const ctx = requestContext.get();
    return this.db.run(async (tx) => {
      const r = await this.load(tx, id, true);
      if (r.payerUserId !== ctx.userId) throw new AppError('NOT_FOUND');
      if (r.status !== 'created' && r.status !== 'failed') throw new AppError('PAYMENT_NOT_PAYABLE', { status: r.status });
      await this.close(tx, r, 'cancelled_by_payer', ctx.userId);
      return { id: r.id, status: 'cancelled' as const };
    });
  }

  /** The referencing module withdraws its request (e.g. a registration was cancelled). */
  async closeRequest(tx: Executor, id: string, reason: string) {
    const r = await this.load(tx, id, true);
    if (r.status === 'cancelled') return;
    if (r.status !== 'created' && r.status !== 'failed') throw new AppError('PAYMENT_NOT_PAYABLE', { status: r.status });
    await this.close(tx, r, reason, requestContext.find()?.userId ?? null);
  }

  private async close(tx: Executor, r: RequestRow, reason: string, actorUserId: string | null) {
    await tx.update(paymentRequests).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(paymentRequests.id, r.id));
    await this.event(tx, r, 'cancelled', { reason }, actorUserId);
    await this.outbox.emit('payment.cancelled', { requestId: r.id, refType: r.refType, refId: r.refId, refStepId: r.refStepId, reason }, `payment.cancelled:${r.id}`, r.tenantId, tx);
  }

  // ── finance staff ────────────────────────────────────────────────────────

  async list(q: { status?: PaymentStatus; from?: string; to?: string; q?: string; limit: number; offset: number }) {
    await this.acl.assert('payment.view');
    return this.db.run(async (tx) => {
      const where = and(
        q.status ? eq(paymentRequests.status, q.status) : undefined,
        q.from ? sql`${paymentRequests.createdAt} >= ${q.from}::timestamptz` : undefined,
        q.to ? sql`${paymentRequests.createdAt} < ${q.to}::timestamptz` : undefined,
        q.q ? sql`(${paymentRequests.trackingCode} ilike ${'%' + q.q + '%'} or ${users.fullName} ilike ${'%' + q.q + '%'})` : undefined,
      );
      const items = await tx
        .select({
          id: paymentRequests.id,
          trackingCode: paymentRequests.trackingCode,
          title: paymentRequests.title,
          serviceKey: paymentRequests.serviceKey,
          amount: paymentRequests.amount,
          status: paymentRequests.status,
          payer: users.fullName,
          createdAt: paymentRequests.createdAt,
          paidAt: paymentRequests.paidAt,
        })
        .from(paymentRequests)
        .innerJoin(users, eq(users.id, paymentRequests.payerUserId))
        .where(where)
        .orderBy(desc(paymentRequests.createdAt))
        .limit(q.limit)
        .offset(q.offset);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(paymentRequests).innerJoin(users, eq(users.id, paymentRequests.payerUserId)).where(where)) as [{ n: number }];
      return { items, total: n };
    });
  }

  /** A finance officer settles a request whose result is unknown (status `review`). */
  async decideReview(id: string, outcome: 'succeeded' | 'failed', reason: string) {
    await this.acl.assert('payment.manage');
    const ctx = requestContext.get();
    await this.db.run(async (tx) => {
      const r = await this.load(tx, id, true);
      if (r.status !== 'review') throw new AppError('INVALID_STATE_TRANSITION', { status: r.status });
      if (outcome === 'succeeded') {
        const [t] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.requestId, r.id)).orderBy(desc(paymentTransactions.startedAt)).limit(1);
        if (!t) throw new AppError('INVALID_STATE_TRANSITION');
        await tx.update(paymentTransactions).set({ status: 'succeeded', finishedAt: new Date() }).where(eq(paymentTransactions.id, t.id));
        await this.succeed(tx, r, t.id, t.referenceId, ctx.userId ?? null);
      } else {
        await tx.update(paymentTransactions).set({ status: 'failed', finishedAt: new Date() }).where(and(eq(paymentTransactions.requestId, r.id), inArray(paymentTransactions.status, ['started', 'unknown'])));
        await tx.update(paymentRequests).set({ status: 'failed', updatedAt: new Date() }).where(eq(paymentRequests.id, r.id));
        await this.event(tx, r, 'review_failed', { reason }, ctx.userId ?? null);
      }
    });
    await this.audit.record({ action: `payment.review.${outcome}`, targetType: 'payment_request', targetId: id, reason });
    return this.get(id);
  }

  // ── background jobs ──────────────────────────────────────────────────────

  /**
   * PAY-07: re-verifies attempts without a final answer, moves long-unknown ones to review and
   * cancels requests whose deadline passed. Returns how many rows changed.
   */
  async reconcile(now = new Date()): Promise<number> {
    const active = await this.db.sys.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, 'active'));
    let changed = 0;
    for (const { id: tenantId } of active) {
      await this.db.background(tenantId, 'payment-reconcile', async (tx) => {
        const stale = await tx
          .select()
          .from(paymentTransactions)
          .where(and(inArray(paymentTransactions.status, ['started', 'unknown']), sql`${paymentTransactions.startedAt} < ${new Date(now.getTime() - STALE_MS)}`))
          .limit(200);
        for (const t of stale) {
          try {
            const before = t.status;
            await tx.transaction(async (sp) => {
              await this.settle(sp, t.requestId, t.authority!);
              const [after] = await sp.select({ status: paymentTransactions.status }).from(paymentTransactions).where(eq(paymentTransactions.id, t.id));
              if (after!.status !== before) changed++;
              if ((after!.status === 'unknown' || after!.status === 'started') && t.startedAt.getTime() < now.getTime() - REVIEW_AFTER_MS) {
                const r = await this.load(sp, t.requestId, true);
                if (r.status === 'pending') {
                  await sp.update(paymentRequests).set({ status: 'review', updatedAt: now }).where(eq(paymentRequests.id, r.id));
                  await this.event(sp, r, 'review', { transactionId: t.id, reason: 'no_answer' });
                  await this.outbox.emit('payment.review', { requestId: r.id }, `payment.review:${r.id}:${t.id}`, r.tenantId, sp);
                  changed++;
                }
              }
            });
          } catch (err) {
            this.logger.warn({ err, transactionId: t.id }, 'reconciliation failed for one attempt');
          }
        }
        const expired = await tx
          .select()
          .from(paymentRequests)
          .where(and(inArray(paymentRequests.status, ['created', 'failed']), sql`${paymentRequests.expiresAt} < ${now}`))
          .for('update')
          .limit(200);
        for (const r of expired) {
          await this.close(tx, r, 'expired', null);
          changed++;
        }
      });
    }
    return changed;
  }

  /** PAY-07 daily check: per tenant, succeeded transactions vs. succeeded requests must agree. */
  async dailyReconciliation(day: Date) {
    await this.acl.assert('payment.view');
    const from = new Date(day);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 86_400_000);
    return this.db.run(async (tx) => {
      const rows = (
        await tx.execute<{ requests: number; request_total: string; transactions: number; transaction_total: string; mismatched: number }>(sql`
          select
            (select count(*)::int from payment_requests where status = 'succeeded' and paid_at >= ${from} and paid_at < ${to}) as requests,
            (select coalesce(sum(amount), 0)::text from payment_requests where status = 'succeeded' and paid_at >= ${from} and paid_at < ${to}) as request_total,
            (select count(*)::int from payment_transactions where status = 'succeeded' and finished_at >= ${from} and finished_at < ${to}) as transactions,
            (select coalesce(sum(amount), 0)::text from payment_transactions where status = 'succeeded' and finished_at >= ${from} and finished_at < ${to}) as transaction_total,
            (select count(*)::int from payment_requests pr
               where pr.status = 'succeeded' and pr.paid_at >= ${from} and pr.paid_at < ${to}
                 and (select count(*) from payment_transactions t where t.request_id = pr.id and t.status = 'succeeded') <> 1) as mismatched`)
      ).rows[0]!;
      return {
        day: from.toISOString().slice(0, 10),
        requests: rows.requests,
        requestTotal: Number(rows.request_total),
        transactions: rows.transactions,
        transactionTotal: Number(rows.transaction_total),
        mismatched: rows.mismatched,
        balanced: rows.requests === rows.transactions && rows.request_total === rows.transaction_total && rows.mismatched === 0,
      };
    });
  }

  /** Receipt (PAY-09): payer or authorised staff, only after success. */
  async receipt(id: string) {
    const detail = await this.get(id);
    if (!detail.receipt) throw new AppError('NOT_FOUND');
    const [t] = await this.db.sys.select({ nameFa: tenants.nameFa }).from(tenants).where(eq(tenants.id, requestContext.get().tenant!.id));
    return {
      tenant: t?.nameFa ?? '',
      receiptNo: detail.receipt.receiptNo,
      trackingCode: detail.trackingCode,
      title: detail.title,
      amount: detail.amount,
      referenceId: detail.receipt.referenceId,
      issuedAt: detail.receipt.issuedAt,
      payer: detail.payer?.fullName ?? '',
    };
  }
}
