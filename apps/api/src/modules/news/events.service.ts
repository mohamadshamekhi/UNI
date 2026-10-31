import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { DbService, type Executor } from '../../database/db.service.js';
import { eventRegistrations, events, feeSchedules, fileObjects, memberships, tenants, users, type EventStatus, type RegistrationRule, type RegistrationStatus } from '../../database/schema.js';
import { AclService } from '../acl/acl.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { formFieldSchema } from '../workflow/definition.js';
import { validateForm } from '../workflow/forms.js';
import { pgArray } from './audience.js';
import { cleanHtml } from './html.js';

type EventRow = typeof events.$inferSelect;
const ACTIVE: RegistrationStatus[] = ['registered', 'pending', 'approved'];
/** statuses that hold a seat (a registration waiting for its payment keeps its place) */
const HOLDING: RegistrationStatus[] = [...ACTIVE, 'awaiting_payment'];
/** time a paid registration has to pay before its seat is released */
const PAY_WINDOW_MS = 48 * 3_600_000;
const formSchema = z.array(formFieldSchema).max(20);
/** who may submit to a call for papers: members of the organising university, by unit or role */
const paperRuleSchema = z
  .object({
    members: z.boolean().optional(),
    roles: z.array(z.string().max(60)).max(20).optional(),
    units: z.array(z.object({ id: z.string().uuid(), tree: z.boolean().optional() })).max(20).optional(),
  })
  .strict();
const ruleSchema = z
  .object({
    members: z.boolean().optional(),
    authenticated: z.boolean().optional(),
    roles: z.array(z.string().max(60)).max(20).optional(),
    units: z.array(z.object({ id: z.string().uuid(), tree: z.boolean().optional() })).max(20).optional(),
    tenants: z.array(z.string().uuid()).max(50).optional(),
  })
  .strict();

export interface EventInput {
  title: string;
  descriptionHtml?: string;
  category?: string;
  organizer?: string;
  organizerUnitId?: string | null;
  startsAt: string;
  endsAt: string;
  location?: string;
  onlineUrl?: string;
  coverFileId?: string | null;
  visibility: 'own_tenant' | 'selected_tenants' | 'public';
  visibleTenantIds?: string[];
  registrationRule: RegistrationRule;
  capacity?: number | null;
  waitlist?: boolean;
  registrationDeadline?: string | null;
  requiresApproval?: boolean;
  allowCancel?: boolean;
  form?: unknown[];
  newsPostId?: string | null;
  feeAmount?: number | null;
  paperTrackId?: string | null;
  paperDeadline?: string | null;
  paperRule?: RegistrationRule | null;
}

const code = () => randomBytes(5).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X').slice(0, 8);

/**
 * Events (section 11): visibility, registration rule and (later) paper submission are three
 * independent rules (EVT-02). Events can be shown to other universities; their registrations always
 * live in the organising tenant.
 */
@Injectable()
export class EventsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly acl: AclService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly payments: PaymentsService,
  ) {}

  /** Paid events (EVT/PAY): the payment result confirms or releases the seat. */
  onModuleInit() {
    this.outbox.on('payment.succeeded', async ({ tenantId, payload }) => {
      if (!tenantId || payload.refType !== 'event_registration') return;
      await this.db.background(tenantId, 'event.payment', async (tx) => {
        const [r] = await tx.select().from(eventRegistrations).where(eq(eventRegistrations.id, payload.refId as string)).limit(1);
        if (!r || r.status !== 'awaiting_payment') return;
        const e = await this.load(tx, r.eventId);
        const status: RegistrationStatus = e.requiresApproval ? 'pending' : 'registered';
        await tx.update(eventRegistrations).set({ status }).where(eq(eventRegistrations.id, r.id));
        await this.outbox.emit('event.registered', { eventId: e.id, registrationId: r.id, status }, `event.registered:${r.id}:paid`, tenantId, tx);
      });
    });
    this.outbox.on('payment.cancelled', async ({ tenantId, payload }) => {
      if (!tenantId || payload.refType !== 'event_registration') return;
      await this.db.background(tenantId, 'event.payment', async (tx) => {
        const [r] = await tx.select().from(eventRegistrations).where(eq(eventRegistrations.id, payload.refId as string)).limit(1);
        if (!r || r.status !== 'awaiting_payment') return;
        const e = await this.load(tx, r.eventId);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${e.id}))`);
        await tx.update(eventRegistrations).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(eventRegistrations.id, r.id));
        await this.promote(tx, e);
      });
    });
  }

  /** Paid registration: creates its payment request (amount from the event's tariff). */
  private async requestPayment(tx: Executor, e: EventRow, registrationId: string, userId: string, membershipId: string | null) {
    const deadline = e.registrationDeadline && e.registrationDeadline.getTime() < Date.now() + PAY_WINDOW_MS ? e.registrationDeadline : new Date(Date.now() + PAY_WINDOW_MS);
    const pr = await this.payments.createRequest(tx, e.tenantId, {
      serviceKey: `event:${e.id}`,
      title: `ثبت‌نام «${e.title}»`,
      payerUserId: userId,
      payerMembershipId: membershipId,
      refType: 'event_registration',
      refId: registrationId,
      expiresAt: deadline,
      idempotencyKey: `event_registration:${registrationId}`,
    });
    await tx.update(eventRegistrations).set({ paymentRequestId: pr.id }).where(eq(eventRegistrations.id, registrationId));
    return pr.id;
  }

  /** A call for papers needs an active track of the same university (EVT-11). */
  private async checkTrack(tx: Executor, trackId: string | null | undefined) {
    if (!trackId) return;
    const r = await tx.execute(sql`select 1 from paper_tracks where id = ${trackId} and active`);
    if (!r.rows.length) throw new AppError('VALIDATION_FAILED', { field: 'paperTrackId' });
  }

  /** The event's price is a versioned tariff `event:<id>` (PAY-10); the organiser sets it with the event. */
  private async syncFee(tx: Executor, e: EventRow, amount: number | null | undefined) {
    if (amount === undefined || amount === null) return;
    const current = await this.payments.currentFee(tx, `event:${e.id}`);
    if (current?.amount === amount) return;
    const [{ v }] = (await tx.execute<{ v: number }>(sql`select coalesce(max(version), 0)::int + 1 as v from fee_schedules where service_key = ${`event:${e.id}`}`)).rows as [{ v: number }];
    await tx.insert(feeSchedules).values({ tenantId: e.tenantId, serviceKey: `event:${e.id}`, title: `ثبت‌نام «${e.title}»`, amount, version: v, createdBy: requestContext.get().userId });
  }

  private me() {
    const ctx = requestContext.get();
    if (!ctx.userId) throw new AppError('UNAUTHENTICATED');
    return { userId: ctx.userId, membershipId: ctx.membershipStatus === 'active' ? (ctx.membershipId ?? null) : null, tenantId: ctx.tenant!.id };
  }

  private async assertManage(unitId: string | null) {
    if (!(await this.acl.has('event.manage', { unitId }))) throw new AppError('FORBIDDEN', { permission: 'event.manage' });
  }

  private fields(input: Partial<EventInput>) {
    const form = input.form !== undefined ? formSchema.safeParse(input.form) : null;
    if (form && !form.success) throw new AppError('VALIDATION_FAILED', { field: 'form' });
    if (input.startsAt && input.endsAt && new Date(input.endsAt) < new Date(input.startsAt)) throw new AppError('VALIDATION_FAILED', { field: 'endsAt' });
    const paperRule = input.paperRule ? paperRuleSchema.safeParse(input.paperRule) : null;
    if (paperRule && !paperRule.success) throw new AppError('VALIDATION_FAILED', { field: 'paperRule' });
    const parsedRule = input.registrationRule ? ruleSchema.safeParse(input.registrationRule) : null;
    if (parsedRule && !parsedRule.success) throw new AppError('VALIDATION_FAILED', { field: 'registrationRule' });
    const rule = parsedRule?.data;
    if (rule && !Object.values(rule).some((v) => (Array.isArray(v) ? v.length : !!v))) throw new AppError('VALIDATION_FAILED', { field: 'registrationRule' });
    return {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.descriptionHtml !== undefined ? { descriptionHtml: cleanHtml(input.descriptionHtml) } : {}),
      ...(input.category !== undefined ? { category: input.category.trim() || null } : {}),
      ...(input.organizer !== undefined ? { organizer: input.organizer.trim() || null } : {}),
      ...(input.organizerUnitId !== undefined ? { organizerUnitId: input.organizerUnitId } : {}),
      ...(input.startsAt ? { startsAt: new Date(input.startsAt) } : {}),
      ...(input.endsAt ? { endsAt: new Date(input.endsAt) } : {}),
      ...(input.location !== undefined ? { location: input.location.trim() || null } : {}),
      ...(input.onlineUrl !== undefined ? { onlineUrl: input.onlineUrl.trim() || null } : {}),
      ...(input.coverFileId !== undefined ? { coverFileId: input.coverFileId } : {}),
      ...(input.visibility ? { visibility: input.visibility } : {}),
      ...(input.visibleTenantIds ? { visibleTenantIds: [...new Set(input.visibleTenantIds)].slice(0, 50) } : {}),
      ...(rule ? { registrationRule: rule } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.waitlist !== undefined ? { waitlist: input.waitlist } : {}),
      ...(input.registrationDeadline !== undefined ? { registrationDeadline: input.registrationDeadline ? new Date(input.registrationDeadline) : null } : {}),
      ...(input.requiresApproval !== undefined ? { requiresApproval: input.requiresApproval } : {}),
      ...(input.allowCancel !== undefined ? { allowCancel: input.allowCancel } : {}),
      ...(form ? { form: form.data } : {}),
      ...(input.newsPostId !== undefined ? { newsPostId: input.newsPostId } : {}),
      ...(input.feeAmount !== undefined ? { feeAmount: input.feeAmount } : {}),
      ...(input.paperTrackId !== undefined ? { paperTrackId: input.paperTrackId } : {}),
      ...(input.paperDeadline !== undefined ? { paperDeadline: input.paperDeadline ? new Date(input.paperDeadline) : null } : {}),
      ...(input.paperRule !== undefined ? { paperRule: paperRule?.data ?? null } : {}),
    };
  }

  // ── organisers ─────────────────────────────────────────────────────────

  async create(input: EventInput) {
    await this.assertManage(input.organizerUnitId ?? null);
    const ctx = requestContext.get();
    const f = this.fields(input);
    const [e] = await this.db.run(async (tx) => {
      await this.checkTrack(tx, input.paperTrackId);
      const rows = await tx
        .insert(events)
        .values({ tenantId: ctx.tenant!.id, title: f.title!, startsAt: f.startsAt!, endsAt: f.endsAt!, visibility: f.visibility!, registrationRule: f.registrationRule!, ...f, createdBy: ctx.userId })
        .returning();
      await this.syncFee(tx, rows[0]!, input.feeAmount);
      return rows;
    });
    await this.audit.record({ action: 'event.created', targetType: 'event', targetId: e!.id, after: { title: e!.title } });
    return e!;
  }

  private async load(tx: Executor, id: string): Promise<EventRow> {
    const [e] = await tx.select().from(events).where(eq(events.id, id)).limit(1);
    if (!e) throw new AppError('NOT_FOUND');
    return e;
  }

  async update(id: string, input: Partial<EventInput>) {
    return this.db.run(async (tx) => {
      const e = await this.load(tx, id);
      await this.assertManage(e.organizerUnitId);
      if (input.organizerUnitId !== undefined && input.organizerUnitId !== e.organizerUnitId) await this.assertManage(input.organizerUnitId ?? null);
      if (e.status === 'cancelled' || e.status === 'held') throw new AppError('INVALID_STATE_TRANSITION');
      if (input.paperTrackId !== undefined && input.paperTrackId !== e.paperTrackId) await this.checkTrack(tx, input.paperTrackId);
      const [u] = await tx.update(events).set({ ...this.fields(input), updatedAt: new Date() }).where(eq(events.id, id)).returning();
      await this.syncFee(tx, u!, input.feeAmount);
      return u!;
    });
  }

  /** EVT-08 status moves; cancelling tells every active registrant. */
  async setStatus(id: string, status: EventStatus, reason?: string) {
    return this.db.run(async (tx) => {
      const e = await this.load(tx, id);
      await this.assertManage(e.organizerUnitId);
      const allowed: Record<EventStatus, EventStatus[]> = {
        draft: [],
        published: ['draft', 'registration_closed'],
        registration_open: ['draft', 'published', 'registration_closed'],
        registration_closed: ['registration_open', 'published'],
        held: ['published', 'registration_open', 'registration_closed'],
        cancelled: ['draft', 'published', 'registration_open', 'registration_closed'],
      };
      if (!allowed[status].includes(e.status)) throw new AppError('INVALID_STATE_TRANSITION', { from: e.status, to: status });
      const [u] = await tx.update(events).set({ status, updatedAt: new Date() }).where(eq(events.id, id)).returning();
      await this.audit.record({ action: `event.${status}`, targetType: 'event', targetId: id, reason });
      if (status === 'cancelled') await this.outbox.emit('event.cancelled', { eventId: id, reason: reason ?? null }, `event.cancelled:${id}`);
      return u!;
    });
  }

  async manageList() {
    return this.db.run(async (tx) => {
      const filter = await this.acl.filterFor('event.manage');
      const rows = await tx.select().from(events).orderBy(desc(events.startsAt)).limit(300);
      if (filter.all) return rows;
      // organisers see events of their units (and unit-less events only with tenant scope)
      const out = [];
      for (const e of rows) if (e.organizerUnitId && (await this.acl.has('event.manage', { unitId: e.organizerUnitId }))) out.push(e);
      return out;
    });
  }

  async manageGet(id: string) {
    return this.db.run(async (tx) => {
      const e = await this.load(tx, id);
      await this.assertManage(e.organizerUnitId);
      const counts = (
        await tx.execute<{ status: RegistrationStatus; n: number }>(sql`select status, count(*)::int as n from event_registrations where event_id = ${id} group by status`)
      ).rows;
      const [{ papers }] = (await tx.execute<{ papers: number }>(sql`select count(*)::int as papers from papers where event_id = ${id} and status <> 'draft'`)).rows as [{ papers: number }];
      return { ...e, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), submittedPapers: papers };
    });
  }

  /** EVT-06: registrations in the organiser's scope, with answers. */
  async registrations(id: string) {
    return this.db.run(async (tx) => {
      const e = await this.load(tx, id);
      await this.assertManage(e.organizerUnitId);
      const rows = await tx
        .select({ r: eventRegistrations, fullName: users.fullName, mobile: users.mobile, email: users.email, homeTenant: tenants.nameFa })
        .from(eventRegistrations)
        .innerJoin(users, eq(users.id, eventRegistrations.userId))
        .leftJoin(tenants, eq(tenants.id, eventRegistrations.homeTenantId))
        .where(eq(eventRegistrations.eventId, id))
        .orderBy(asc(eventRegistrations.createdAt));
      return rows.map(({ r, fullName, mobile, email, homeTenant }) => ({
        id: r.id,
        status: r.status,
        code: r.code,
        fullName,
        mobile,
        email,
        homeTenant,
        answers: r.answers,
        attendedAt: r.attendedAt,
        createdAt: r.createdAt,
      }));
    });
  }

  /** CSV with a BOM so Excel opens Persian text correctly. */
  async exportCsv(id: string) {
    const e = await this.db.run((tx) => this.load(tx, id));
    const rows = await this.registrations(id);
    const form = (e.form as { key: string; label: string }[]) ?? [];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['کد', 'نام', 'موبایل', 'ایمیل', 'دانشگاه', 'وضعیت', 'حضور', 'تاریخ ثبت‌نام', ...form.map((f) => f.label)];
    const lines = rows.map((r) =>
      [r.code, r.fullName, r.mobile, r.email, r.homeTenant, r.status, r.attendedAt ? 'بله' : '', r.createdAt.toISOString(), ...form.map((f) => r.answers[f.key])].map(esc).join(','),
    );
    await this.audit.record({ action: 'event.registrations.exported', targetType: 'event', targetId: id, after: { rows: rows.length } });
    return { filename: `registrations-${id.slice(0, 8)}.csv`, body: `﻿${[head.map(esc).join(','), ...lines].join('\r\n')}` };
  }

  async decide(registrationId: string, approve: boolean) {
    return this.db.run(async (tx) => {
      const [r] = await tx.select().from(eventRegistrations).where(eq(eventRegistrations.id, registrationId)).limit(1);
      if (!r) throw new AppError('NOT_FOUND');
      const e = await this.load(tx, r.eventId);
      await this.assertManage(e.organizerUnitId);
      if (r.status !== 'pending') throw new AppError('INVALID_STATE_TRANSITION');
      await tx.update(eventRegistrations).set({ status: approve ? 'approved' : 'rejected', decidedAt: new Date() }).where(eq(eventRegistrations.id, r.id));
      await this.outbox.emit('event.registration.decided', { eventId: e.id, registrationId: r.id, approved: approve }, `event.registration.decided:${r.id}`, e.tenantId, tx);
      if (!approve) await this.promote(tx, e);
      return { id: r.id, status: approve ? 'approved' : 'rejected' };
    });
  }

  async attendance(registrationId: string, attended: boolean) {
    return this.db.run(async (tx) => {
      const [r] = await tx.select().from(eventRegistrations).where(eq(eventRegistrations.id, registrationId)).limit(1);
      if (!r) throw new AppError('NOT_FOUND');
      const e = await this.load(tx, r.eventId);
      await this.assertManage(e.organizerUnitId);
      if (!ACTIVE.includes(r.status)) throw new AppError('INVALID_STATE_TRANSITION');
      await tx.update(eventRegistrations).set({ attendedAt: attended ? new Date() : null }).where(eq(eventRegistrations.id, r.id));
      return { id: r.id, attended };
    });
  }

  /** Other active universities an event can be shared with (EVT-02). */
  async partnerTenants() {
    const me = requestContext.get().tenant!.id;
    const rows = await this.db.sys.select({ id: tenants.id, nameFa: tenants.nameFa }).from(tenants).where(eq(tenants.status, 'active')).orderBy(asc(tenants.nameFa));
    return rows.filter((t) => t.id !== me);
  }

  // ── participants ───────────────────────────────────────────────────────

  /** Events this viewer may see: own tenant's (not drafts) plus other universities' public / shared ones. */
  async list(q: { upcoming?: boolean; limit: number; offset: number }) {
    const ctx = requestContext.get();
    const tenantId = ctx.tenant!.id;
    const rows = (
      await this.db.sys.execute<EventRow & Record<string, unknown>>(sql`
        select e.id, e.tenant_id, e.title, e.category, e.organizer, e.starts_at, e.ends_at, e.location, e.online_url, e.cover_file_id,
               e.status, e.visibility, e.capacity, e.registration_deadline, e.fee_amount, (e.paper_track_id is not null and (e.paper_deadline is null or e.paper_deadline > now())) as call_open, t.name_fa as tenant_name, t.slug as tenant_slug,
               (select count(*)::int from event_registrations r where r.event_id = e.id and r.status in ('registered', 'pending', 'approved', 'awaiting_payment')) as taken
        from events e join tenants t on t.id = e.tenant_id and t.status = 'active'
        where e.status <> 'draft'
          and (e.tenant_id = ${tenantId} or e.visibility = 'public' or (e.visibility = 'selected_tenants' and ${tenantId}::uuid = any(e.visible_tenant_ids)))
          ${q.upcoming ? sql`and e.ends_at >= now()` : sql``}
        order by e.starts_at ${q.upcoming ? sql`asc` : sql`desc`}
        limit ${q.limit} offset ${q.offset}`)
    ).rows;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      organizer: r.organizer,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      location: r.location,
      online: !!r.online_url,
      coverFileId: r.cover_file_id,
      status: r.status,
      capacity: r.capacity,
      taken: r.taken,
      registrationDeadline: r.registration_deadline,
      feeAmount: r.fee_amount === null ? null : Number(r.fee_amount),
      callForPapers: !!r.call_open,
      host: r.tenant_id === tenantId ? null : { nameFa: r.tenant_name, slug: r.tenant_slug },
    }));
  }

  /** One event if this viewer's university may see it (own, public or shared). */
  private async visibleEvent(eventId: string, viewerTenantId = requestContext.get().tenant!.id): Promise<EventRow> {
    const tenantId = viewerTenantId;
    const [e] = await this.db.sys.select().from(events).where(eq(events.id, eventId)).limit(1);
    const ok =
      e &&
      e.status !== 'draft' &&
      (e.tenantId === tenantId || e.visibility === 'public' || (e.visibility === 'selected_tenants' && e.visibleTenantIds.includes(tenantId)));
    if (!ok) throw new AppError('NOT_FOUND');
    return e!;
  }

  /** Cover image of a visible event (non-confidential, scanned). */
  async coverFile(viewerTenantSlug: string, eventId: string) {
    const [t] = await this.db.sys.select({ id: tenants.id, status: tenants.status }).from(tenants).where(eq(tenants.slug, viewerTenantSlug)).limit(1);
    if (!t || t.status !== 'active') throw new AppError('NOT_FOUND');
    const e = await this.visibleEvent(eventId, t.id);
    if (!e.coverFileId) throw new AppError('NOT_FOUND');
    const [f] = await this.db.sys.select().from(fileObjects).where(eq(fileObjects.id, e.coverFileId)).limit(1);
    if (!f || f.tenantId !== e.tenantId || f.isConfidential || (f.scanStatus !== 'clean' && f.scanStatus !== 'skipped')) throw new AppError('NOT_FOUND');
    return f;
  }

  /**
   * EVT-11 for the event page: the call's track, deadline and whether this viewer may submit.
   * Papers live in the organising university, so only its own members can submit.
   */
  private async callInfo(e: EventRow, userId: string | null) {
    if (!e.paperTrackId) return null;
    const [track] = (await this.db.sys.execute<{ name_fa: string; review_mode: string }>(sql`select name_fa, review_mode from paper_tracks where id = ${e.paperTrackId}`)).rows;
    const open = ['published', 'registration_open', 'registration_closed'].includes(e.status) && (!e.paperDeadline || e.paperDeadline > new Date());
    const sameTenant = requestContext.get().tenant!.id === e.tenantId;
    const check = userId && sameTenant ? await this.eligible({ ...e, registrationRule: e.paperRule ?? { members: true } }, userId) : null;
    return { open, deadline: e.paperDeadline, trackName: track?.name_fa ?? '', reviewMode: track?.review_mode ?? null, eligible: !!check?.ok && !!check.membershipId, ownMembersOnly: !sameTenant };
  }

  /** EVT-03: may this signed-in user register? Evaluated against the organising tenant. */
  private async eligible(e: EventRow, userId: string): Promise<{ ok: boolean; membershipId: string | null }> {
    const ctx = requestContext.get();
    const rule = e.registrationRule;
    const [m] = await this.db.sys
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.tenantId, e.tenantId), eq(memberships.userId, userId), eq(memberships.status, 'active')))
      .limit(1);
    const membershipId = m?.id ?? null;
    if (rule.authenticated) return { ok: true, membershipId };
    if (rule.tenants?.length && ctx.membershipStatus === 'active' && rule.tenants.includes(ctx.tenant!.id)) return { ok: true, membershipId };
    if (!membershipId) return { ok: false, membershipId };
    if (rule.members) return { ok: true, membershipId };
    if (rule.roles?.length) {
      const r = await this.db.sys.execute(sql`
        select 1 from role_assignments ra join roles r on r.id = ra.role_id and r.archived_at is null
        where ra.membership_id = ${membershipId} and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_to is null or ra.valid_to > now())
          and r.key = any(${pgArray(rule.roles)}::text[]) limit 1`);
      if (r.rows.length) return { ok: true, membershipId };
    }
    if (rule.units?.length) {
      for (const u of rule.units) {
        const r = await this.db.sys.execute(sql`
          select 1 from membership_units mu join org_units mine on mine.id = mu.unit_id join org_units target on target.id = ${u.id}
          where mu.membership_id = ${membershipId} and (mine.id = target.id or (${!!u.tree} and mine.path like target.path || '%')) limit 1`);
        if (r.rows.length) return { ok: true, membershipId };
      }
    }
    return { ok: false, membershipId };
  }

  async detail(eventId: string) {
    const e = await this.visibleEvent(eventId);
    const ctx = requestContext.get();
    const [mine] = ctx.userId
      ? await this.db.sys
          .select()
          .from(eventRegistrations)
          .where(and(eq(eventRegistrations.eventId, e.id), eq(eventRegistrations.userId, ctx.userId), sql`${eventRegistrations.status} <> 'cancelled'`))
          .limit(1)
      : [];
    const [{ taken }] = (await this.db.sys.execute<{ taken: number }>(sql`select count(*)::int as taken from event_registrations where event_id = ${e.id} and status in ('registered', 'pending', 'approved', 'awaiting_payment')`)).rows as [{ taken: number }];
    const [host] = await this.db.sys.select({ nameFa: tenants.nameFa, slug: tenants.slug }).from(tenants).where(eq(tenants.id, e.tenantId));
    const eligible = ctx.userId ? (await this.eligible(e, ctx.userId)).ok : false;
    const open = e.status === 'registration_open' && (!e.registrationDeadline || e.registrationDeadline > new Date());
    return {
      id: e.id,
      title: e.title,
      descriptionHtml: e.descriptionHtml,
      category: e.category,
      organizer: e.organizer,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      location: e.location,
      onlineUrl: mine && ACTIVE.includes(mine.status) ? e.onlineUrl : e.onlineUrl ? 'registered-only' : null,
      coverFileId: e.coverFileId,
      status: e.status,
      capacity: e.capacity,
      taken,
      waitlist: e.waitlist,
      registrationDeadline: e.registrationDeadline,
      requiresApproval: e.requiresApproval,
      allowCancel: e.allowCancel,
      form: e.form,
      host: e.tenantId === ctx.tenant!.id ? null : host,
      registration: { open, eligible, full: !!e.capacity && taken >= e.capacity },
      callForPapers: await this.callInfo(e, ctx.userId ?? null),
      mine: mine ? { id: mine.id, status: mine.status, code: mine.code, attended: !!mine.attendedAt, paymentId: mine.paymentRequestId } : null,
      feeAmount: e.feeAmount,
    };
  }

  /** EVT-05/07: register once (idempotent); capacity, waitlist and approval decide the status. */
  async register(eventId: string, answers: unknown) {
    const me = this.me();
    const e = await this.visibleEvent(eventId);
    if (e.status !== 'registration_open' || (e.registrationDeadline && e.registrationDeadline < new Date())) throw new AppError('EVENT_REGISTRATION_CLOSED');
    const { ok, membershipId } = await this.eligible(e, me.userId);
    if (!ok) throw new AppError('EVENT_NOT_ELIGIBLE');
    const form = formSchema.parse(e.form);
    const values = form.length ? validateForm(form, answers ?? {}) : { public: {}, internal: {} };
    return this.db.withTenant(e.tenantId, async (tx) => {
      // serialise registrations of one event so capacity holds under concurrency
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${e.id}))`);
      const [existing] = await tx
        .select()
        .from(eventRegistrations)
        .where(and(eq(eventRegistrations.eventId, e.id), eq(eventRegistrations.userId, me.userId), sql`${eventRegistrations.status} <> 'cancelled'`))
        .limit(1);
      if (existing) return { id: existing.id, status: existing.status, code: existing.code, duplicate: true, paymentId: existing.paymentRequestId };
      const [{ taken }] = (await tx.execute<{ taken: number }>(sql`select count(*)::int as taken from event_registrations where event_id = ${e.id} and status in ('registered', 'pending', 'approved', 'awaiting_payment')`)).rows as [{ taken: number }];
      const full = !!e.capacity && taken >= e.capacity;
      if (full && !e.waitlist) throw new AppError('EVENT_FULL');
      const status: RegistrationStatus = full ? 'waitlisted' : e.feeAmount ? 'awaiting_payment' : e.requiresApproval ? 'pending' : 'registered';
      const [r] = await tx
        .insert(eventRegistrations)
        .values({
          tenantId: e.tenantId,
          eventId: e.id,
          userId: me.userId,
          homeTenantId: me.tenantId,
          membershipId,
          status,
          answers: { ...values.public, ...values.internal },
          code: code(),
        })
        .returning();
      const paymentId = status === 'awaiting_payment' ? await this.requestPayment(tx, e, r!.id, me.userId, membershipId) : null;
      if (status !== 'awaiting_payment') await this.outbox.emit('event.registered', { eventId: e.id, registrationId: r!.id, status }, `event.registered:${r!.id}`, e.tenantId, tx);
      return { id: r!.id, status: r!.status, code: r!.code, duplicate: false, paymentId };
    });
  }

  /** The participant cancels (if allowed); the first wait-listed person moves up. */
  async cancel(registrationId: string) {
    const me = this.me();
    const [r] = await this.db.sys.select().from(eventRegistrations).where(eq(eventRegistrations.id, registrationId)).limit(1);
    if (!r || r.userId !== me.userId) throw new AppError('NOT_FOUND');
    return this.db.withTenant(r.tenantId, async (tx) => {
      const e = await this.load(tx, r.eventId);
      if (!e.allowCancel || r.status === 'cancelled' || e.status === 'held') throw new AppError('INVALID_STATE_TRANSITION');
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${e.id}))`);
      if (r.status === 'awaiting_payment' && r.paymentRequestId) await this.payments.closeRequest(tx, r.paymentRequestId, 'registration_cancelled');
      await tx.update(eventRegistrations).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(eventRegistrations.id, r.id));
      if (HOLDING.includes(r.status)) await this.promote(tx, e);
      return { id: r.id, status: 'cancelled' };
    });
  }

  private async promote(tx: Executor, e: EventRow) {
    if (!e.capacity) return;
    const [{ taken }] = (await tx.execute<{ taken: number }>(sql`select count(*)::int as taken from event_registrations where event_id = ${e.id} and status in ('registered', 'pending', 'approved', 'awaiting_payment')`)).rows as [{ taken: number }];
    if (taken >= e.capacity) return;
    const [next] = await tx
      .select()
      .from(eventRegistrations)
      .where(and(eq(eventRegistrations.eventId, e.id), eq(eventRegistrations.status, 'waitlisted')))
      .orderBy(asc(eventRegistrations.createdAt))
      .limit(1);
    if (!next) return;
    await tx.update(eventRegistrations).set({ status: e.feeAmount ? 'awaiting_payment' : e.requiresApproval ? 'pending' : 'registered' }).where(eq(eventRegistrations.id, next.id));
    if (e.feeAmount) await this.requestPayment(tx, e, next.id, next.userId, next.membershipId);
    await this.outbox.emit('event.promoted', { eventId: e.id, registrationId: next.id }, `event.promoted:${next.id}`, e.tenantId, tx);
  }

  /** The signed-in user's registrations across universities. */
  async mine() {
    const me = this.me();
    const rows = await this.db.sys
      .select({ r: eventRegistrations, title: events.title, startsAt: events.startsAt, endsAt: events.endsAt, location: events.location, eventStatus: events.status, host: tenants.nameFa })
      .from(eventRegistrations)
      .innerJoin(events, eq(events.id, eventRegistrations.eventId))
      .innerJoin(tenants, eq(tenants.id, events.tenantId))
      .where(and(eq(eventRegistrations.userId, me.userId), inArray(eventRegistrations.status, ['registered', 'pending', 'approved', 'waitlisted', 'rejected', 'awaiting_payment'])))
      .orderBy(desc(events.startsAt));
    return rows.map(({ r, ...x }) => ({ id: r.id, eventId: r.eventId, status: r.status, code: r.code, attended: !!r.attendedAt, paymentId: r.paymentRequestId, ...x }));
  }
}
