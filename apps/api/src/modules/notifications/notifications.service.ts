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
];

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
