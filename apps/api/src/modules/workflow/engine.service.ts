import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { DbService, type Executor } from '../../database/db.service.js';
import {
  caseEvents,
  cases,
  caseTasks,
  memberships,
  membershipUnits,
  orgUnits,
  workflows,
  workflowVersions,
  type CaseStatusCategory,
} from '../../database/schema.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { BUILTIN_APPLICANT, definitionSchema, selectorSchema, type Selector, type Step, type Transition, type WorkflowDefinition } from './definition.js';
import { evaluateCondition } from './expr.js';
import { dueDate, nextAt, slaSchedule, type WorkCalendar } from './calendar.js';
import { CalendarService } from './calendar.service.js';
import { assertCaseData, validateForm } from './forms.js';

export type CaseRow = typeof cases.$inferSelect;
type TaskRow = typeof caseTasks.$inferSelect;
type HumanStep = Extract<Step, { type: 'human' }>;

/** Actions the applicant can take on a case returned for revision (`@applicant`). */
export const APPLICANT_ACTIONS = ['resubmit', 'withdraw'] as const;
const MAX_AUTOMATIC_HOPS = 64;
const OPEN: CaseStatusCategory[] = ['open', 'revising'];

/** Mutable state of one engine pass, written back once at the end. */
interface Run {
  tx: Executor;
  c: CaseRow;
  def: WorkflowDefinition;
  steps: Map<string, Step>;
  now: Date;
  hops: number;
  cal?: WorkCalendar;
}

export interface ActInput {
  action: string;
  form?: unknown;
  data?: unknown;
  publicNote?: string;
  internalNote?: string;
  expectedVersion?: number;
}

/** Decision keys exposed to conditions: `case.decisions.review_a` for step `review-a`. */
const decisionKey = (stepId: string) => stepId.replaceAll('-', '_');

/**
 * Role task eligibility (WF-01): the member holds the task's role through a valid assignment
 * whose scope covers the case — any scope for task scope `tenant`; the case unit (or a subtree
 * containing it) for `case_unit`; the case unit or any ancestor for `case_unit_tree`.
 * `ct` and `c` must be in scope as case_tasks / cases aliases.
 */
export const roleCoverage = (membershipId: string | SQL) => sql`exists (
  select 1 from role_assignments ra
  join roles r on r.id = ra.role_id and r.archived_at is null and r.tenant_id = ct.tenant_id
  left join org_units au on au.id = ra.scope_id and ra.scope_type in ('unit', 'unit_tree')
  left join org_units cu on cu.id = c.unit_id
  where ra.membership_id = ${membershipId}
    and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_to is null or ra.valid_to > now())
    and r.key = ct.role_key
    and (ct.scope = 'tenant' or ra.scope_type = 'tenant'
      or (ra.scope_type = 'case' and ra.scope_id = c.id)
      or (ct.scope = 'case_unit' and ((ra.scope_type = 'unit' and ra.scope_id = c.unit_id)
                                      or (ra.scope_type = 'unit_tree' and cu.path like au.path || '%')))
      or (ct.scope = 'case_unit_tree' and ra.scope_type in ('unit', 'unit_tree') and cu.path like au.path || '%')))`;

/**
 * Workflow runtime (section 7.4): starts cases on the matching published version and moves them
 * through steps. Every call runs inside the request transaction; concurrent actions on one case
 * are serialised by an optimistic lock on `cases.lock_version` (WF-05).
 */
@Injectable()
export class WorkflowEngine {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly calendar: CalendarService,
  ) {}

  private actor() {
    const ctx = requestContext.get();
    if (!ctx.membershipId || !ctx.userId) throw new AppError('MEMBERSHIP_REQUIRED');
    return { userId: ctx.userId, membershipId: ctx.membershipId, tenantId: ctx.tenant!.id };
  }

  async start(input: { requestType: string; title?: string; unitId?: string; data?: unknown }): Promise<CaseRow> {
    const actor = this.actor();
    const data = assertCaseData(input.data);
    return this.db.run(async (tx) => {
      const unitId = input.unitId ?? (await this.primaryUnit(tx, actor.membershipId));
      const unitPath = unitId ? await this.unitPath(tx, unitId) : null;
      if (unitId && !unitPath) throw new AppError('UNIT_INVALID');

      const version = await this.pickVersion(tx, input.requestType, { degree: data.degree, unitPath });
      const def = definitionSchema.parse(version.definition);
      const [c] = await tx
        .insert(cases)
        .values({
          tenantId: actor.tenantId,
          workflowVersionId: version.id,
          requestType: input.requestType,
          title: input.title ?? null,
          applicantMembershipId: actor.membershipId,
          unitId,
          data,
        })
        .returning();
      const run = this.newRun(tx, c!, def);
      await this.event(run, { type: 'created' });
      await this.enter(run, def.start);
      await this.save(run);
      await this.outbox.emit('case.created', { caseId: c!.id, requestType: c!.requestType }, `case.created:${c!.id}`);
      return run.c;
    });
  }

  /** Performs `action` on an open task (WF-04/05). */
  async act(caseId: string, taskId: string, input: ActInput): Promise<CaseRow> {
    const actor = this.actor();
    return this.db.run(async (tx) => {
      const { c, task } = await this.claim(tx, caseId, taskId, input.expectedVersion);
      await this.assertCanAct(tx, c, task, actor.membershipId);
      const def = await this.definitionOf(tx, c.workflowVersionId);
      const run = this.newRun(tx, c, def);
      await this.completeTask(run, task, input.action, actor.userId);

      if (task.assigneeType === 'applicant') {
        if (!(APPLICANT_ACTIONS as readonly string[]).includes(input.action)) throw new AppError('VALIDATION_FAILED', { field: 'action' });
        run.c.currentSteps = run.c.currentSteps.filter((s) => s !== BUILTIN_APPLICANT);
        if (input.action === 'withdraw') {
          await this.event(run, { type: 'withdrawn', stepId: BUILTIN_APPLICANT, publicNote: input.publicNote });
          await this.close(run, 'cancelled');
        } else {
          run.c.data = { ...run.c.data, ...assertCaseData(input.data) };
          assertCaseData(run.c.data);
          run.c.statusCategory = 'open';
          await this.event(run, { type: 'resubmitted', stepId: BUILTIN_APPLICANT, publicNote: input.publicNote });
          await this.enter(run, task.returnTo!);
        }
      } else {
        const step = run.steps.get(task.stepId) as HumanStep | undefined;
        if (!step || step.type !== 'human') throw new AppError('INVALID_STATE_TRANSITION');
        if (!step.actions.includes(input.action)) throw new AppError('VALIDATION_FAILED', { field: 'action' });
        const form = validateForm(step.form, input.form);
        run.c.data = { ...run.c.data, ...form.public };
        run.c.internal = { ...run.c.internal, ...form.internal };
        run.c.decisions = { ...run.c.decisions, [decisionKey(step.id)]: input.action };
        run.c.currentSteps = run.c.currentSteps.filter((s) => s !== step.id);
        await this.event(run, {
          type: 'action',
          stepId: step.id,
          action: input.action,
          publicNote: input.publicNote,
          internalNote: input.internalNote,
          form: { ...form.public, ...form.internal },
        });

        if (task.parallelOf) await this.join(run, task.parallelOf);
        else {
          const t = this.pick(run, step.id, input.action);
          await this.follow(run, t, step.id);
        }
      }
      await this.save(run);
      return run.c;
    });
  }

  // ── engine internals ─────────────────────────────────────────────────────

  private newRun(tx: Executor, c: CaseRow, def: WorkflowDefinition): Run {
    return { tx, c: { ...c }, def, steps: new Map(def.steps.map((s) => [s.id, s])), now: new Date(), hops: 0 };
  }

  private scope(run: Run) {
    const ctx = requestContext.find();
    return {
      data: run.c.data,
      case: { requestType: run.c.requestType, unitId: run.c.unitId, internal: run.c.internal, decisions: run.c.decisions },
      actor: { membershipId: ctx?.membershipId ?? null },
    };
  }

  /** Transition for a human action: first matching `when`, else an unconditional one. */
  private pick(run: Run, from: string, action: string): Transition {
    const candidates = run.def.transitions.filter((t) => t.from === from && t.action === action);
    const scope = this.scope(run);
    const t = candidates.find((x) => x.when && evaluateCondition(x.when, scope)) ?? candidates.find((x) => !x.when);
    if (!t) throw new AppError('INVALID_STATE_TRANSITION', { step: from, action });
    return t;
  }

  private async follow(run: Run, t: Transition, from: string): Promise<void> {
    if (t.to !== BUILTIN_APPLICANT) return this.enter(run, t.to);
    // return to the applicant for revision; resubmission re-enters the step that sent it back
    const taskId = await this.createTask(run, { stepId: BUILTIN_APPLICANT, assigneeType: 'applicant', returnTo: from });
    await this.outbox.emit('case.returned', { caseId: run.c.id, taskId }, `case.returned:${taskId}`);
    run.c.statusCategory = 'revising';
    run.c.currentSteps = [...run.c.currentSteps, BUILTIN_APPLICANT];
    await this.event(run, { type: 'returned', stepId: from, toStep: BUILTIN_APPLICANT });
  }

  private async enter(run: Run, stepId: string, parallelOf?: string): Promise<void> {
    if (++run.hops > MAX_AUTOMATIC_HOPS) throw new AppError('INVALID_STATE_TRANSITION', { reason: 'loop' });
    const step = run.steps.get(stepId);
    if (!step) throw new AppError('INVALID_STATE_TRANSITION', { step: stepId });
    switch (step.type) {
      case 'human': {
        const assignee = await this.resolveAssignee(run, step);
        run.cal ??= step.sla ? await this.calendar.load(run.tx, run.c.tenantId, run.now) : undefined;
        const dueAt = run.cal ? dueDate(run.now, step.sla, run.cal) : null;
        const schedule = slaSchedule(dueAt, step.sla, run.now);
        const taskId = await this.createTask(run, { stepId, ...assignee, parallelOf, dueAt, slaSchedule: schedule, slaNextAt: nextAt(schedule) });
        await this.outbox.emit('case.task.assigned', { caseId: run.c.id, taskId }, `case.task.assigned:${taskId}`);
        run.c.currentSteps = [...run.c.currentSteps, stepId];
        await this.event(run, { type: 'entered', stepId });
        return;
      }
      case 'decision': {
        const out = run.def.transitions.filter((t) => t.from === stepId);
        const scope = this.scope(run);
        const t = out.find((x) => x.when && evaluateCondition(x.when, scope)) ?? out.find((x) => x.otherwise);
        if (!t) throw new AppError('INVALID_STATE_TRANSITION', { step: stepId });
        await this.event(run, { type: 'decided', stepId, toStep: t.to });
        return this.follow(run, t, stepId);
      }
      case 'parallel': {
        await this.event(run, { type: 'entered', stepId });
        for (const b of step.branches) await this.enter(run, b, stepId);
        return;
      }
      case 'system': {
        // side effects go through the outbox so they commit (or roll back) with the transition
        await this.outbox.emit(
          `workflow.${step.task}`,
          { caseId: run.c.id, stepId, params: step.params },
          `workflow.${step.task}:${run.c.id}:${stepId}:${run.c.lockVersion}:${run.hops}`,
        );
        await this.event(run, { type: 'system', stepId, action: step.task });
        const t = run.def.transitions.find((x) => x.from === stepId)!;
        return this.follow(run, t, stepId);
      }
      case 'end':
        await this.event(run, { type: 'entered', stepId });
        return this.close(run, step.outcome);
    }
  }

  /** A branch of a parallel finished: continue once the join condition holds. */
  private async join(run: Run, parallelId: string) {
    const p = run.steps.get(parallelId);
    if (!p || p.type !== 'parallel') throw new AppError('INVALID_STATE_TRANSITION');
    const open = await run.tx
      .select({ id: caseTasks.id, stepId: caseTasks.stepId })
      .from(caseTasks)
      .where(and(eq(caseTasks.caseId, run.c.id), eq(caseTasks.parallelOf, parallelId), eq(caseTasks.status, 'open')));
    if (p.join === 'all' && open.length > 0) return;
    if (open.length) {
      await run.tx.update(caseTasks).set({ status: 'cancelled', completedAt: run.now }).where(inArray(caseTasks.id, open.map((o) => o.id)));
      const cancelled = new Set(open.map((o) => o.stepId));
      run.c.currentSteps = run.c.currentSteps.filter((s) => !cancelled.has(s));
    }
    await this.event(run, { type: 'joined', stepId: parallelId });
    await this.follow(run, run.def.transitions.find((t) => t.from === parallelId)!, parallelId);
  }

  private async close(run: Run, category: CaseStatusCategory) {
    await run.tx
      .update(caseTasks)
      .set({ status: 'cancelled', completedAt: run.now })
      .where(and(eq(caseTasks.caseId, run.c.id), eq(caseTasks.status, 'open')));
    run.c.statusCategory = category;
    run.c.currentSteps = [];
    run.c.closedAt = run.now;
    await this.event(run, { type: 'closed', action: category });
    await this.outbox.emit('case.closed', { caseId: run.c.id, outcome: category }, `case.closed:${run.c.id}`);
  }

  private async resolveAssignee(run: Run, step: HumanStep): Promise<Pick<TaskRow, 'assigneeType' | 'roleKey' | 'scope' | 'assigneeMembershipId'>> {
    const a = step.assignee;
    if ('role' in a) return { assigneeType: 'role', roleKey: a.role, scope: a.scope, assigneeMembershipId: null };
    const raw = 'membershipId' in a ? a.membershipId : run.c.data[a.dynamic.slice('data.'.length)];
    if (typeof raw !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw)) throw new AppError('ASSIGNEE_UNRESOLVED', { step: step.id });
    // SoD (WF): the applicant can never review their own case
    if (raw === run.c.applicantMembershipId) throw new AppError('SEPARATION_OF_DUTIES', { step: step.id });
    const [m] = await run.tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.id, raw), eq(memberships.status, 'active')))
      .limit(1);
    if (!m) throw new AppError('ASSIGNEE_UNRESOLVED', { step: step.id });
    return { assigneeType: 'membership', roleKey: null, scope: null, assigneeMembershipId: m.id };
  }

  private async createTask(
    run: Run,
    t: Pick<TaskRow, 'stepId' | 'assigneeType'> &
      Partial<Pick<TaskRow, 'roleKey' | 'scope' | 'assigneeMembershipId' | 'returnTo' | 'dueAt' | 'slaSchedule' | 'slaNextAt'>> & { parallelOf?: string },
  ): Promise<string> {
    const [row] = await run.tx
      .insert(caseTasks)
      .values({ tenantId: run.c.tenantId, caseId: run.c.id, ...t, parallelOf: t.parallelOf ?? null })
      .returning({ id: caseTasks.id });
    return row!.id;
  }

  private async completeTask(run: Run, task: TaskRow, action: string, userId: string) {
    const done = await run.tx
      .update(caseTasks)
      .set({ status: 'done', action, completedAt: run.now, completedBy: userId })
      .where(and(eq(caseTasks.id, task.id), eq(caseTasks.status, 'open')))
      .returning({ id: caseTasks.id });
    if (!done.length) throw new AppError('CASE_STALE');
  }

  private async event(
    run: Run,
    e: { type: string; stepId?: string; action?: string; toStep?: string; publicNote?: string; internalNote?: string; form?: Record<string, unknown> },
  ) {
    const ctx = requestContext.find();
    await run.tx.insert(caseEvents).values({
      tenantId: run.c.tenantId,
      caseId: run.c.id,
      actorUserId: ctx?.userId ?? null,
      actorMembershipId: ctx?.membershipId ?? null,
      type: e.type,
      stepId: e.stepId ?? null,
      action: e.action ?? null,
      toStep: e.toStep ?? null,
      publicNote: e.publicNote ?? null,
      internalNote: e.internalNote ?? null,
      form: e.form && Object.keys(e.form).length ? e.form : null,
    });
  }

  private async save(run: Run) {
    const c = run.c;
    await run.tx
      .update(cases)
      .set({
        data: c.data,
        internal: c.internal,
        decisions: c.decisions,
        currentSteps: c.currentSteps,
        statusCategory: c.statusCategory,
        closedAt: c.closedAt,
        updatedAt: run.now,
      })
      .where(eq(cases.id, c.id));
    run.c.updatedAt = run.now;
  }

  /** WF-22: closes a case when a deadline action says so (no actor; runs in the SLA sweep). */
  async closeBySystem(tx: Executor, caseId: string, category: 'cancelled' | 'failure', stepId: string) {
    const [c] = await tx.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    if (!c || !OPEN.includes(c.statusCategory)) return;
    // bump the lock so an action racing with the sweep fails cleanly
    await tx.update(cases).set({ lockVersion: sql`${cases.lockVersion} + 1` }).where(eq(cases.id, caseId));
    const run = this.newRun(tx, c, await this.definitionOf(tx, c.workflowVersionId));
    await this.event(run, { type: 'expired', stepId });
    await this.close(run, category);
    await this.save(run);
  }

  // ── shared helpers (also used by CasesService) ───────────────────────────

  /**
   * Locks the case for one transition: bumps `lock_version` only if nobody else did since it was
   * read. A concurrent second submit waits on the row lock, then finds the version changed.
   */
  async claim(tx: Executor, caseId: string, taskId: string, expectedVersion?: number): Promise<{ c: CaseRow; task: TaskRow }> {
    const [c] = await tx.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    if (!c) throw new AppError('NOT_FOUND');
    if (expectedVersion !== undefined && expectedVersion !== c.lockVersion) throw new AppError('CASE_STALE');
    const [task] = await tx.select().from(caseTasks).where(and(eq(caseTasks.id, taskId), eq(caseTasks.caseId, caseId))).limit(1);
    if (!task) throw new AppError('NOT_FOUND');
    if (task.status !== 'open' || !OPEN.includes(c.statusCategory)) throw new AppError('INVALID_STATE_TRANSITION');
    const bumped = await tx
      .update(cases)
      .set({ lockVersion: sql`${cases.lockVersion} + 1` })
      .where(and(eq(cases.id, caseId), eq(cases.lockVersion, c.lockVersion)))
      .returning({ lockVersion: cases.lockVersion });
    if (!bumped.length) throw new AppError('CASE_STALE');
    return { c: { ...c, lockVersion: bumped[0]!.lockVersion }, task };
  }

  /** Throws unless `membershipId` may act on the task (assignment + SoD). */
  async assertCanAct(tx: Executor, c: CaseRow, task: TaskRow, membershipId: string) {
    if (!(await this.canAct(tx, c, task, membershipId))) {
      throw new AppError(c.applicantMembershipId === membershipId && task.assigneeType !== 'applicant' ? 'SEPARATION_OF_DUTIES' : 'FORBIDDEN');
    }
  }

  async canAct(tx: Executor, c: Pick<CaseRow, 'id' | 'applicantMembershipId'>, task: TaskRow, membershipId: string): Promise<boolean> {
    if (task.status !== 'open') return false;
    if (task.assigneeType === 'applicant') return c.applicantMembershipId === membershipId;
    if (c.applicantMembershipId === membershipId) return false;
    if (task.assigneeType === 'membership') return task.assigneeMembershipId === membershipId;
    const res = await tx.execute<{ ok: boolean }>(sql`
      select ${roleCoverage(membershipId)} as ok
      from case_tasks ct join cases c on c.id = ct.case_id
      where ct.id = ${task.id}`);
    return !!res.rows[0]?.ok;
  }

  async definitionOf(tx: Executor, versionId: string): Promise<WorkflowDefinition> {
    const [v] = await tx.select({ definition: workflowVersions.definition }).from(workflowVersions).where(eq(workflowVersions.id, versionId)).limit(1);
    if (!v) throw new AppError('NOT_FOUND');
    return definitionSchema.parse(v.definition);
  }

  /** WF-07: the published version whose selector matches the request. */
  private async pickVersion(tx: Executor, requestType: string, subject: { degree: unknown; unitPath: string | null }) {
    const rows = await tx
      .select({ id: workflowVersions.id, definition: workflowVersions.definition, selector: workflowVersions.selector })
      .from(workflowVersions)
      .innerJoin(workflows, eq(workflows.id, workflowVersions.workflowId))
      .where(and(eq(workflowVersions.status, 'published'), eq(workflows.requestType, requestType), isNull(workflows.archivedAt)))
      .orderBy(desc(workflowVersions.publishedAt));
    const match = rows.find((r) => selectorMatches(selectorSchema.parse(r.selector), subject));
    if (!match) throw new AppError('WORKFLOW_NOT_AVAILABLE', { requestType });
    return match;
  }

  private async primaryUnit(tx: Executor, membershipId: string): Promise<string | null> {
    const [u] = await tx
      .select({ unitId: membershipUnits.unitId })
      .from(membershipUnits)
      .where(eq(membershipUnits.membershipId, membershipId))
      .orderBy(desc(membershipUnits.isPrimary))
      .limit(1);
    return u?.unitId ?? null;
  }

  private async unitPath(tx: Executor, unitId: string): Promise<string | null> {
    const [u] = await tx.select({ path: orgUnits.path }).from(orgUnits).where(and(eq(orgUnits.id, unitId), eq(orgUnits.status, 'active'))).limit(1);
    return u?.path ?? null;
  }
}

export function selectorMatches(s: Selector, subject: { degree: unknown; unitPath: string | null }): boolean {
  if (s.degrees?.length && !(typeof subject.degree === 'string' && s.degrees.includes(subject.degree))) return false;
  if (s.unitIds?.length && !(subject.unitPath && s.unitIds.some((id) => subject.unitPath!.includes(`/${id}/`)))) return false;
  return true;
}
