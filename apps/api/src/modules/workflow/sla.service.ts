import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { and, eq, lte, sql } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { DbService, type Executor } from '../../database/db.service.js';
import { caseEvents, cases, caseTasks } from '../../database/schema.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { dueDate, nextAt, slaSchedule } from './calendar.js';
import { CalendarService } from './calendar.service.js';
import type { Step } from './definition.js';
import { WorkflowEngine } from './engine.service.js';

const SWEEP_MS = 60_000;
const BATCH = 200;
type TaskRow = typeof caseTasks.$inferSelect;
type Sla = NonNullable<Extract<Step, { type: 'human' }>['sla']>;

/**
 * Deadline sweep (WF-21/22/24). The schedule lives on each task row (`sla_next_at`), so a restart
 * or a missed tick loses nothing: the next sweep picks up every entry whose time has passed.
 * Reminders go out through the outbox; overdue actions run in the same transaction.
 */
@Injectable()
export class SlaService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SlaService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly engine: WorkflowEngine,
    private readonly calendar: CalendarService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.SLA_SWEEP === 'off') return;
    this.timer = setInterval(() => void this.sweep().catch((err) => this.logger.error({ err }, 'sla sweep failed')), SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Processes every task with a due schedule entry; returns how many tasks were handled. */
  async sweep(now = new Date()): Promise<number> {
    const due = await this.db.sys
      .select({ id: caseTasks.id, tenantId: caseTasks.tenantId })
      .from(caseTasks)
      .where(and(eq(caseTasks.status, 'open'), lte(caseTasks.slaNextAt, now)))
      .orderBy(caseTasks.slaNextAt)
      .limit(BATCH);
    let handled = 0;
    for (const t of due) {
      try {
        if (await this.process(t.id, t.tenantId, now)) handled++;
      } catch (err) {
        this.logger.error({ err, taskId: t.id }, 'sla entry failed');
      }
    }
    return handled;
  }

  /** One task, under RLS of its tenant, with a row lock so parallel instances never double-send. */
  private process(taskId: string, tenantId: string, now: Date): Promise<boolean> {
    return this.db.transaction({ tenantId }, (tx) =>
      requestContext.run({ requestId: `sla:${taskId}`, tenant: { id: tenantId, slug: '', status: 'active' }, tx }, async () => {
        const locked = await tx.execute(
          sql`select id from case_tasks where id = ${taskId} and status = 'open' and sla_next_at <= ${now} for update skip locked`,
        );
        if (!locked.rows.length) return false;
        const [task] = await tx.select().from(caseTasks).where(eq(caseTasks.id, taskId));
        const [c] = await tx.select().from(cases).where(eq(cases.id, task!.caseId));
        const def = await this.engine.definitionOf(tx, c!.workflowVersionId);
        const step = def.steps.find((s) => s.id === task!.stepId);
        const sla = step?.type === 'human' ? step.sla : undefined;

        const schedule = task!.slaSchedule.map((e) => ({ ...e }));
        let overdue = false;
        for (const e of schedule) {
          if (e.done || new Date(e.at) > now) continue;
          e.done = true;
          await this.outbox.emit(
            'case.task.reminder',
            { caseId: c!.id, taskId, stepId: task!.stepId, kind: e.kind, dueAt: task!.dueAt?.toISOString() ?? null },
            `sla:${taskId}:${e.kind}:${e.at}`,
          );
          if (e.kind === 'due' && !task!.overdueAt) overdue = true;
        }
        await tx
          .update(caseTasks)
          .set({ slaSchedule: schedule, slaNextAt: nextAt(schedule), ...(overdue ? { overdueAt: now } : {}) })
          .where(eq(caseTasks.id, taskId));
        if (overdue && sla) await this.onOverdue(tx, task!, sla, now);
        return true;
      }),
    );
  }

  /** WF-22: the configured action once a deadline passes. */
  private async onOverdue(tx: Executor, task: TaskRow, sla: Sla, now: Date) {
    const event = (type: string, internalNote?: string) =>
      tx.insert(caseEvents).values({ tenantId: task.tenantId, caseId: task.caseId, type, stepId: task.stepId, internalNote: internalNote ?? null });

    switch (sla.onOverdue) {
      case 'escalate': {
        const to = sla.escalateTo;
        await tx
          .update(caseTasks)
          .set({ escalatedAt: now, ...(to ? { assigneeType: 'role' as const, roleKey: to.role, scope: to.scope, assigneeMembershipId: null } : {}) })
          .where(eq(caseTasks.id, task.id));
        await event('escalated', to ? `→ ${to.role}` : undefined);
        await this.outbox.emit('case.task.escalated', { caseId: task.caseId, taskId: task.id, role: to?.role ?? null }, `sla:${task.id}:escalated`);
        return;
      }
      case 'extend':
        if (!task.autoExtended) {
          const cal = await this.calendar.load(tx, task.tenantId, now);
          const dueAt = dueDate(now, { ...sla, days: sla.extendDays }, cal);
          const schedule = slaSchedule(dueAt, sla, now);
          await tx
            .update(caseTasks)
            .set({ dueAt, slaSchedule: schedule, slaNextAt: nextAt(schedule), overdueAt: null, autoExtended: true })
            .where(eq(caseTasks.id, task.id));
          await event('extended', `auto +${sla.extendDays}`);
          return;
        }
        await event('overdue');
        return;
      case 'cancel':
      case 'close':
        await this.engine.closeBySystem(tx, task.caseId, sla.onOverdue === 'cancel' ? 'cancelled' : 'failure', task.stepId);
        return;
      default:
        await event('overdue');
    }
  }
}
