import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { DbService } from '../../database/db.service.js';
import {
  cases,
  memberships,
  notificationDeliveries,
  notificationMutes,
  notificationRules,
  notifications,
  notificationTemplates,
  tenants,
  users,
  workflows,
  workflowVersions,
  type NotificationChannel,
  type TenantSettings,
} from '../../database/schema.js';
import { SmsProvider } from '../../infra/sms.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { definitionSchema } from '../workflow/definition.js';
import { roleCoverage } from '../workflow/engine.service.js';
import { CATALOG, eventDef, render, type NotificationEvent, type Recipient, type TemplateText } from './catalog.js';

const WORKER_MS = 5000;
const MAX_ATTEMPTS = 5;
const QUIET_FROM = 22;
const QUIET_TO = 7;

/** Outbox event types that map one-to-one onto catalog events. */
const DIRECT: NotificationEvent[] = [
  'membership.invited',
  'membership.decided',
  'membership.revision_requested',
  'case.task.assigned',
  'case.returned',
  'case.closed',
  'case.task.escalated',
  'paper.submitted',
  'paper.review.invited',
  'paper.review.reminder',
  'paper.review.declined',
  'paper.reviews_done',
  'paper.revision_requested',
  'paper.revised',
  'paper.decided',
  'paper.withdrawn',
  'news.submitted',
  'news.returned',
  'news.published',
  'event.registered',
  'event.registration.decided',
  'event.promoted',
  'event.cancelled',
];

const REG_STATUS: Record<string, string> = {
  registered: 'قطعی شد',
  pending: 'در انتظار تأیید برگزارکننده است',
  approved: 'تأیید شد',
  rejected: 'رد شد',
  waitlisted: 'در فهرست انتظار است',
  cancelled: 'لغو شد',
};

const PAPER_DECISION: Record<string, string> = {
  accept: 'پذیرفته شد',
  accept_conditional: 'پذیرش مشروط',
  reject: 'رد شد',
  minor_revision: 'اصلاح جزئی',
  major_revision: 'اصلاح اساسی',
};

const OUTCOME: Record<string, string> = { success: 'تأیید شد', failure: 'رد شد', cancelled: 'لغو شد' };

interface Context {
  tenantId: string;
  timeZone: string;
  vars: Record<string, string>;
  recipients: Partial<Record<Recipient, string[]>>;
  links: Partial<Record<Recipient, string>>;
  /** extra key part so repeated reminders for the same task collapse per day (NTF-12) */
  dedupe?: string;
}

const minutesIn = (d: Date, timeZone: string) => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).split(':').map(Number);
  return h! * 60 + m!;
};
const dayIn = (d: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(d);
const faDate = (d: Date | null, timeZone: string) =>
  d ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone, year: 'numeric', month: 'long', day: 'numeric' }).format(d) : '—';

/** `d`, or the next local 07:00 when `d` falls in quiet hours (NTF-13). */
export function afterQuietHours(d: Date, timeZone: string): Date {
  const local = minutesIn(d, timeZone);
  if (local >= QUIET_TO * 60 && local < QUIET_FROM * 60) return d;
  const wait = (QUIET_TO * 60 - local + 1440) % 1440;
  const next = new Date(d.getTime() + wait * 60_000);
  next.setUTCSeconds(0, 0);
  return next;
}

/**
 * Notification service (section 13): outbox events → recipients (by rule) → rendered template per
 * channel → one delivery row each, keyed for idempotency (NTF-05). In-app notifications land in
 * the inbox immediately; SMS/email go through a retrying worker with a dead-letter state (NTF-04).
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly sms: SmsProvider,
  ) {}

  onModuleInit() {
    for (const type of DIRECT) this.outbox.on(type, (e) => this.dispatch(type, e).then(() => undefined));
    this.outbox.on('case.task.reminder', (e) => {
      const kind = e.payload.kind as 'before' | 'due' | 'after';
      return this.dispatch(`case.task.reminder.${kind}`, e).then(() => undefined);
    });
  }

  onApplicationBootstrap() {
    if (process.env.NOTIFY_WORKER === 'off') return;
    this.timer = setInterval(() => void this.deliver().catch((err) => this.logger.error({ err }, 'delivery failed')), WORKER_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ── dispatch ─────────────────────────────────────────────────────────────

  /** Creates deliveries for one domain event; returns how many were created. */
  async dispatch(event: NotificationEvent, e: { id: number; tenantId: string | null; payload: Record<string, unknown> }): Promise<number> {
    if (!e.tenantId) return 0;
    const ctx = await this.context(event, e.tenantId, e.payload);
    if (!ctx) return 0;
    const def = eventDef(event);
    const db = this.db.sys;

    const [ruleRows, templateRows] = await Promise.all([
      db.select().from(notificationRules).where(and(eq(notificationRules.tenantId, ctx.tenantId), eq(notificationRules.event, event))),
      db.select().from(notificationTemplates).where(and(eq(notificationTemplates.tenantId, ctx.tenantId), eq(notificationTemplates.event, event), eq(notificationTemplates.locale, 'fa'))),
    ]);
    const template = (ch: NotificationChannel): TemplateText | undefined => {
      const o = templateRows.find((t) => t.channel === ch);
      return o ? { subject: o.subject ?? undefined, body: o.body } : def.templates[ch];
    };

    // texts leaving the system never carry confidential variables (NTF-07)
    const outsideVars = Object.fromEntries(Object.entries(ctx.vars).filter(([k]) => !def.vars[k]?.sensitive));
    let created = 0;
    for (const rule of def.rules) {
      const override = ruleRows.find((r) => r.recipient === rule.recipient);
      const channels = override ? (override.enabled ? override.channels : []) : rule.channels;
      const userIds = [...new Set(ctx.recipients[rule.recipient] ?? [])];
      if (!channels.length || !userIds.length) continue;
      const muted = def.critical
        ? []
        : await db.select().from(notificationMutes).where(and(eq(notificationMutes.tenantId, ctx.tenantId), inArray(notificationMutes.userId, userIds)));

      for (const userId of userIds) {
        for (const channel of channels) {
          if (muted.some((m) => m.userId === userId && m.channel === channel)) continue;
          const t = template(channel);
          if (!t) continue;
          const vars = channel === 'inapp' ? ctx.vars : outsideVars;
          const subject = t.subject ? render(t.subject, vars) : null;
          const body = render(t.body, vars);
          const key = ctx.dedupe ? `${event}:${ctx.dedupe}:${userId}:${channel}` : `${event}:${e.id}:${userId}:${channel}`;
          const now = new Date();
          const inserted = await db.transaction(async (tx) => {
            const [d] = await tx
              .insert(notificationDeliveries)
              .values({
                tenantId: ctx.tenantId,
                event,
                userId,
                channel,
                critical: def.critical,
                idempotencyKey: key,
                status: channel === 'inapp' ? 'delivered' : 'queued',
                subject,
                body,
                sentAt: channel === 'inapp' ? now : null,
                nextAttemptAt: channel === 'sms' && !def.critical ? afterQuietHours(now, ctx.timeZone) : now,
              })
              .onConflictDoNothing()
              .returning({ id: notificationDeliveries.id });
            if (d && channel === 'inapp') {
              await tx.insert(notifications).values({
                tenantId: ctx.tenantId,
                userId,
                event,
                title: subject ?? def.label,
                body,
                link: ctx.links[rule.recipient] ?? null,
              });
            }
            return !!d;
          });
          if (inserted) created++;
        }
      }
    }
    return created;
  }

  /** Loads what templates and recipient rules need for one event. */
  private async context(event: NotificationEvent, tenantId: string, p: Record<string, unknown>): Promise<Context | null> {
    const db = this.db.sys;
    const [t] = await db.select({ nameFa: tenants.nameFa, slug: tenants.slug, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    if (!t) return null;
    const timeZone = t.settings.timezone ?? 'Asia/Tehran';
    const base = { tenantId, timeZone, vars: { tenantName: t.nameFa } as Record<string, string> };

    if (event.startsWith('membership.')) {
      const userId = p.userId as string;
      const [m] = await db.select({ deadline: memberships.revisionDeadline }).from(memberships).where(eq(memberships.id, p.membershipId as string));
      return {
        ...base,
        vars: { ...base.vars, decisionLabel: p.decision === 'approved' ? 'تأیید شد' : 'رد شد', deadline: faDate(m?.deadline ?? null, timeZone) },
        recipients: { user: [userId] },
        links: { user: `/${t.slug}/me` },
      };
    }

    if (event.startsWith('paper.')) return this.paperContext(event, tenantId, t, timeZone, p);
    if (event.startsWith('news.')) return this.newsContext(tenantId, t, timeZone, p);
    if (event.startsWith('event.')) return this.eventContext(tenantId, t, timeZone, p);

    const caseId = p.caseId as string;
    const [c] = await db
      .select({ id: cases.id, title: cases.title, statusCategory: cases.statusCategory, applicant: memberships.userId, applicantMembership: cases.applicantMembershipId, workflowName: workflows.nameFa, definition: workflowVersions.definition })
      .from(cases)
      .innerJoin(memberships, eq(memberships.id, cases.applicantMembershipId))
      .innerJoin(workflowVersions, eq(workflowVersions.id, cases.workflowVersionId))
      .innerJoin(workflows, eq(workflows.id, workflowVersions.workflowId))
      .where(eq(cases.id, caseId));
    if (!c) return null;
    const vars: Record<string, string> = {
      ...base.vars,
      workflowName: c.workflowName,
      caseRef: c.id.slice(0, 8).toUpperCase(),
      caseTitle: c.title ?? '',
      outcomeLabel: OUTCOME[(p.outcome as string) ?? c.statusCategory] ?? '',
    };
    const ctx: Context = {
      ...base,
      vars,
      recipients: { applicant: [c.applicant] },
      links: { applicant: `/${t.slug}/cases/${c.id}`, assignee: `/t/${t.slug}/cases/${c.id}` },
    };

    const taskId = p.taskId as string | undefined;
    if (taskId && event !== 'case.returned') {
      const res = await db.execute<{ step_id: string; due_at: Date | null }>(sql`select step_id, due_at from case_tasks where id = ${taskId}`);
      const task = res.rows[0];
      if (!task) return null;
      const def = definitionSchema.safeParse(c.definition);
      vars.stepTitle = (def.success && def.data.steps.find((s) => s.id === task.step_id)?.title) || task.step_id;
      vars.dueDate = faDate(task.due_at ? new Date(task.due_at) : null, timeZone);
      ctx.recipients.assignee = await this.assignees(taskId);
      if (event.startsWith('case.task.reminder.')) ctx.dedupe = `${taskId}:${dayIn(new Date(), timeZone)}`;
    }
    return ctx;
  }

  /** Paper events: author, the invited reviewer (members only; guests get their link directly), managers. */
  private async paperContext(event: NotificationEvent, tenantId: string, t: { nameFa: string; slug: string }, timeZone: string, p: Record<string, unknown>): Promise<Context | null> {
    const db = this.db.sys;
    const res = await db.execute<{ id: string; tracking_code: string | null; title: string; author_user: string; due: Date | null; revision_due_at: Date | null }>(sql`
      select pa.id, pa.tracking_code, pa.title, m.user_id as author_user, null::timestamptz as due, pa.revision_due_at
      from papers pa join memberships m on m.id = pa.author_membership_id where pa.id = ${p.paperId as string}`);
    const paper = res.rows[0];
    if (!paper) return null;
    const ctx: Context = {
      tenantId,
      timeZone,
      vars: {
        tenantName: t.nameFa,
        trackingCode: paper.tracking_code ?? '',
        paperTitle: paper.title,
        dueDate: faDate(paper.revision_due_at ? new Date(paper.revision_due_at) : null, timeZone),
        decisionLabel: PAPER_DECISION[(p.decision as string) ?? ''] ?? '',
      },
      recipients: { author: [paper.author_user] },
      links: { author: `/${t.slug}/papers/${paper.id}`, managers: `/t/${t.slug}/papers/${paper.id}` },
    };
    if (p.reviewId) {
      const r = (
        await db.execute<{ user_id: string | null; due_at: Date }>(sql`
          select m.user_id, r.due_at from paper_reviews r left join memberships m on m.id = r.reviewer_membership_id where r.id = ${p.reviewId as string}`)
      ).rows[0];
      if (r) {
        ctx.vars.dueDate = faDate(new Date(r.due_at), timeZone);
        ctx.recipients.reviewer = r.user_id ? [r.user_id] : [];
        ctx.links.reviewer = `/t/${t.slug}/reviews/${p.reviewId as string}`;
        if (event === 'paper.review.reminder') ctx.dedupe = `${p.reviewId as string}:${p.kind as string}`;
      }
    }
    if (Array.isArray(p.reviewIds) && p.reviewIds.length) {
      const rows = (
        await db.execute<{ user_id: string }>(sql`
          select m.user_id from paper_reviews r join memberships m on m.id = r.reviewer_membership_id where r.id in (${sql.join((p.reviewIds as string[]).map((id) => sql`${id}::uuid`), sql`, `)})`)
      ).rows;
      ctx.recipients.released_reviewers = rows.map((x) => x.user_id);
    }
    // review managers: everyone holding paper.screen or paper.decide in this tenant
    ctx.recipients.managers = (
      await db.execute<{ user_id: string }>(sql`
        select distinct m.user_id from role_assignments ra
        join role_permissions rp on rp.role_id = ra.role_id and rp.permission_code in ('paper.screen', 'paper.decide')
        join memberships m on m.id = ra.membership_id and m.status = 'active'
        where ra.tenant_id = ${tenantId} and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_to is null or ra.valid_to > now())`)
    ).rows.map((x) => x.user_id);
    return ctx;
  }

  /**
   * News events. `audience` is resolved with the post's own audience rule, so a restricted post is
   * never announced to someone who could not open it (phase 5 gate).
   */
  private async newsContext(tenantId: string, t: { nameFa: string; slug: string }, timeZone: string, p: Record<string, unknown>): Promise<Context | null> {
    const db = this.db.sys;
    const post = (
      await db.execute<{ id: string; slug: string; title: string; channel_id: string; channel_name: string; author_user: string; status: string }>(sql`
        select np.id, np.slug, np.title, np.channel_id, nc.name_fa as channel_name, m.user_id as author_user, np.status
        from news_posts np join news_channels nc on nc.id = np.channel_id join memberships m on m.id = np.author_membership_id
        where np.id = ${p.postId as string} and np.tenant_id = ${tenantId}`)
    ).rows[0];
    if (!post) return null;
    const ctx: Context = {
      tenantId,
      timeZone,
      vars: { tenantName: t.nameFa, postTitle: post.title, channelName: post.channel_name },
      recipients: { author: [post.author_user] },
      links: { author: `/t/${t.slug}/news/${post.id}`, channel_approvers: `/t/${t.slug}/news/${post.id}`, audience: `/${t.slug}/news/${post.slug}` },
    };
    ctx.recipients.channel_approvers = (
      await db.execute<{ user_id: string }>(sql`
        select distinct m.user_id from memberships m
        where m.tenant_id = ${tenantId} and m.status = 'active' and m.user_id <> ${post.author_user} and (
          exists (select 1 from news_channel_members cm where cm.channel_id = ${post.channel_id} and cm.membership_id = m.id and cm.role in ('approver', 'publisher'))
          or exists (select 1 from role_assignments ra join role_permissions rp on rp.role_id = ra.role_id and rp.permission_code in ('news.approve', 'news.publish')
                     where ra.membership_id = m.id and ra.scope_type = 'tenant' and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_to is null or ra.valid_to > now())))
        limit 500`)
    ).rows.map((x) => x.user_id);
    if (post.status === 'published') {
      ctx.recipients.audience = (
        await db.execute<{ user_id: string }>(sql`
          select distinct m.user_id from memberships m, news_posts np
          where np.id = ${post.id} and m.tenant_id = ${tenantId} and m.status = 'active' and (
            coalesce((np.audience->>'public')::boolean, false)
            or coalesce((np.audience->>'members')::boolean, false)
            or coalesce(np.audience->'memberships', '[]'::jsonb) ? m.id::text
            or exists (
              select 1 from role_assignments ra join roles r on r.id = ra.role_id and r.archived_at is null
              where ra.membership_id = m.id and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_to is null or ra.valid_to > now())
                and coalesce(np.audience->'roles', '[]'::jsonb) ? r.key)
            or exists (
              select 1 from jsonb_array_elements(coalesce(np.audience->'units', '[]'::jsonb)) au
              join org_units target on target.id = (au->>'id')::uuid
              join membership_units mu on mu.membership_id = m.id
              join org_units mine on mine.id = mu.unit_id
              where mine.id = target.id or (coalesce((au->>'tree')::boolean, false) and mine.path like target.path || '%')))
          limit 5000`)
      ).rows.map((x) => x.user_id);
    }
    return ctx;
  }

  /** Event registrations: the registrant (who may belong to another university), or all registrants. */
  private async eventContext(tenantId: string, t: { nameFa: string; slug: string }, timeZone: string, p: Record<string, unknown>): Promise<Context | null> {
    const db = this.db.sys;
    const ev = (await db.execute<{ id: string; title: string; starts_at: Date }>(sql`select id, title, starts_at from events where id = ${p.eventId as string} and tenant_id = ${tenantId}`)).rows[0];
    if (!ev) return null;
    const ctx: Context = {
      tenantId,
      timeZone,
      vars: { tenantName: t.nameFa, eventTitle: ev.title, eventDate: faDate(new Date(ev.starts_at), timeZone), statusLabel: '', reason: (p.reason as string) ?? '' },
      recipients: {},
      links: { registrant: `/${t.slug}/events/${ev.id}`, registrants: `/${t.slug}/events/${ev.id}` },
    };
    if (p.registrationId) {
      const r = (await db.execute<{ user_id: string; status: string }>(sql`select user_id, status from event_registrations where id = ${p.registrationId as string}`)).rows[0];
      if (!r) return null;
      ctx.recipients.registrant = [r.user_id];
      ctx.vars.statusLabel = REG_STATUS[r.status] ?? '';
    } else {
      ctx.recipients.registrants = (
        await db.execute<{ user_id: string }>(sql`select distinct user_id from event_registrations where event_id = ${ev.id} and status in ('registered', 'pending', 'approved', 'waitlisted') limit 5000`)
      ).rows.map((x) => x.user_id);
    }
    return ctx;
  }

  /** Users who can act on a task: the named member, or every holder of the role in scope (never the applicant). */
  private async assignees(taskId: string): Promise<string[]> {
    const res = await this.db.sys.execute<{ user_id: string }>(sql`
      select distinct m.user_id
      from case_tasks ct
      join cases c on c.id = ct.case_id
      join memberships m on m.tenant_id = ct.tenant_id and m.status = 'active'
      where ct.id = ${taskId} and ct.status = 'open' and m.id <> c.applicant_membership_id
        and ((ct.assignee_type = 'membership' and m.id = ct.assignee_membership_id)
          or (ct.assignee_type = 'role' and ${roleCoverage(sql`m.id`)}))
      limit 500`);
    return res.rows.map((r) => r.user_id);
  }

  // ── delivery worker ──────────────────────────────────────────────────────

  /** Sends due SMS/email deliveries with retries; returns how many rows were processed. */
  async deliver(now = new Date(), batch = 50): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.db.sys.transaction(async (tx) => {
        const rows = (
          await tx.execute<{ id: string; tenant_id: string | null; user_id: string; channel: NotificationChannel; body: string; attempts: number }>(sql`
            select id, tenant_id, user_id, channel, body, attempts from notification_deliveries
             where status = 'queued' and next_attempt_at <= ${now}
             order by next_attempt_at limit ${batch} for update skip locked`)
        ).rows;
        const used = new Map<string, number>();
        for (const r of rows) {
          const set = (patch: Partial<typeof notificationDeliveries.$inferInsert>) =>
            tx.update(notificationDeliveries).set(patch).where(eq(notificationDeliveries.id, r.id));
          if (r.channel === 'email') {
            await set({ status: 'skipped', error: 'email_channel_not_configured' });
            continue;
          }
          try {
            if (r.tenant_id) {
              const quota = await this.smsQuota(r.tenant_id);
              if (quota !== undefined) {
                const n = used.get(r.tenant_id) ?? (await this.smsSent(r.tenant_id, now));
                if (n >= quota) {
                  await set({ status: 'dead', error: 'sms_quota_exceeded' });
                  continue;
                }
                used.set(r.tenant_id, n + 1);
              }
            }
            const [u] = await tx.select({ mobile: users.mobile }).from(users).where(eq(users.id, r.user_id));
            if (!u) {
              await set({ status: 'dead', error: 'recipient_missing' });
              continue;
            }
            const res = await this.sms.send({ to: u.mobile, text: r.body, tenantId: r.tenant_id });
            await set({ status: 'sent', sentAt: now, attempts: r.attempts + 1, providerMessageId: res.providerMessageId ?? null, error: null });
          } catch (err) {
            const attempts = r.attempts + 1;
            await set({
              attempts,
              status: attempts >= MAX_ATTEMPTS ? 'dead' : 'queued',
              nextAttemptAt: new Date(now.getTime() + 30_000 * 2 ** attempts),
              error: (err as Error).message.slice(0, 500),
            });
          }
        }
        return rows.length;
      });
    } finally {
      this.running = false;
    }
  }

  private async smsQuota(tenantId: string): Promise<number | undefined> {
    const [t] = await this.db.sys.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    return (t?.settings as TenantSettings | undefined)?.notifications?.smsMonthlyQuota;
  }

  /** SMS sent by a tenant in the current calendar month (NTF-11). */
  async smsSent(tenantId: string, now = new Date()): Promise<number> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [row] = await this.db.sys
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.tenantId, tenantId),
          eq(notificationDeliveries.channel, 'sms'),
          inArray(notificationDeliveries.status, ['sent', 'delivered']),
          gte(notificationDeliveries.sentAt, monthStart),
        ),
      );
    return row?.n ?? 0;
  }
}
