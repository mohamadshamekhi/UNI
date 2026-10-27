import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
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
import { FilesService } from '../files/files.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { BUILTIN_APPLICANT, definitionSchema, formFieldSchema, selectorSchema, type Selector, type Step, type Transition, type WorkflowDefinition } from './definition.js';
import { evaluateCondition } from './expr.js';
import { selectorSpecificity } from './validate.js';
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

export interface SimStep {
  action: string;
  form?: unknown;
  data?: unknown;
}

export interface SimResult {
  ok: boolean;
  error?: { code: string; message: string; details?: Record<string, unknown> };
  status: CaseStatusCategory;
  path: { type: string; step: string | null; action: string | null; toStep: string | null }[];
  open: { stepId: string; step: string; actions: string[]; form: unknown[]; assignee: string; dueAt: Date | null }[];
  data: Record<string, unknown>;
  internal: Record<string, unknown>;
}

export interface ActInput {
  action: string;
  form?: unknown;
  data?: unknown;
  publicNote?: string;
  internalNote?: string;
  expectedVersion?: number;
  /** with a return to the applicant: fields to fix and days to do it (THS-07) */
  revision?: { fields?: string[]; deadlineDays?: number };
}

/** Decision keys exposed to conditions: `case.decisions.review_a` for step `review-a`. */
const decisionKey = (stepId: string) => stepId.replaceAll('-', '_');

/**
 * Role task eligibility (WF-01): the member holds the task's role through a valid assignment
 * whose scope covers the case — any scope for task scope `tenant`; the case unit (or a subtree
 * containing it) for `case_unit`; the case unit or any ancestor for `case_unit_tree`.
 * `ct` and `c` must be in scope as case_tasks / cases aliases.
 */
export const memberCoverage = (membership: SQL, roleKey: SQL, scope: SQL, unitId: SQL, caseId: SQL) => sql`exists (
  select 1 from role_assignments ra
  join roles r on r.id = ra.role_id and r.archived_at is null and r.tenant_id = ra.tenant_id
  left join org_units au on au.id = ra.scope_id and ra.scope_type in ('unit', 'unit_tree')
  left join org_units cu on cu.id = ${unitId}
  where ra.membership_id = ${membership}
    and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_to is null or ra.valid_to > now())
    and r.key = ${roleKey}
    and (${scope} = 'tenant' or ra.scope_type = 'tenant'
      or (ra.scope_type = 'case' and ra.scope_id = ${caseId})
      or (${scope} = 'case_unit' and ((ra.scope_type = 'unit' and ra.scope_id = ${unitId})
                                      or (ra.scope_type = 'unit_tree' and cu.path like au.path || '%')))
      or (${scope} = 'case_unit_tree' and ra.scope_type in ('unit', 'unit_tree') and cu.path like au.path || '%')))`;

/** Role task eligibility (WF-01); `ct` and `c` must be case_tasks / cases aliases in scope. */
export const roleCoverage = (membershipId: string | SQL) =>
  memberCoverage(typeof membershipId === 'string' ? sql`${membershipId}::uuid` : membershipId, sql`ct.role_key`, sql`ct.scope`, sql`c.unit_id`, sql`c.id`);

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
    private readonly files: FilesService,
  ) {}

  private actor() {
    const ctx = requestContext.get();
    if (!ctx.membershipId || !ctx.userId) throw new AppError('MEMBERSHIP_REQUIRED');
    return { userId: ctx.userId, membershipId: ctx.membershipId, tenantId: ctx.tenant!.id };
  }

  async start(input: { requestType: string; title?: string; unitId?: string; data?: unknown; draft?: boolean }): Promise<CaseRow> {
    const actor = this.actor();
    const data = assertCaseData(input.data);
    return this.db.run(async (tx) => {
      const unitId = input.unitId ?? (await this.primaryUnit(tx, actor.membershipId));
      const unitPath = unitId ? await this.unitPath(tx, unitId) : null;
      if (unitId && !unitPath) throw new AppError('UNIT_INVALID');

      const version = await this.pickVersion(tx, input.requestType, { degree: data.degree, unitPath });
      const def = definitionSchema.parse(version.definition);
      const run = await this.createCase(tx, version.id, def, { requestType: input.requestType, title: input.title, unitId, data, actor, draft: input.draft });
      if (input.draft) return run.c;
      await this.outbox.emit('case.created', { caseId: run.c.id, requestType: run.c.requestType }, `case.created:${run.c.id}`);
      return run.c;
    });
  }

  /** THS-01: change a draft (title, data, unit) before it is submitted. */
  async updateDraft(caseId: string, input: { title?: string; unitId?: string; data?: unknown }): Promise<CaseRow> {
    const actor = this.actor();
    return this.db.run(async (tx) => {
      const c = await this.ownDraft(tx, caseId, actor.membershipId);
      const unitId = input.unitId ?? c.unitId;
      if (unitId && unitId !== c.unitId && !(await this.unitPath(tx, unitId))) throw new AppError('UNIT_INVALID');
      const [u] = await tx
        .update(cases)
        .set({ title: input.title ?? c.title, unitId, data: input.data === undefined ? c.data : assertCaseData(input.data), updatedAt: new Date() })
        .where(eq(cases.id, c.id))
        .returning();
      return u!;
    });
  }

  /** THS-01: validates the draft against the current version and starts the workflow. */
  async submit(caseId: string): Promise<CaseRow> {
    const actor = this.actor();
    return this.db.run(async (tx) => {
      const draft = await this.ownDraft(tx, caseId, actor.membershipId);
      const unitPath = draft.unitId ? await this.unitPath(tx, draft.unitId) : null;
      // the version is picked again: a newer one may have been published since the draft was saved
      const version = await this.pickVersion(tx, draft.requestType, { degree: draft.data.degree, unitPath });
      const def = definitionSchema.parse(version.definition);
      const data = this.requestData(def, draft.data);
      const [c] = await tx
        .update(cases)
        .set({ workflowVersionId: version.id, data, statusCategory: 'open', submittedAt: new Date(), lockVersion: sql`${cases.lockVersion} + 1`, updatedAt: new Date() })
        .where(and(eq(cases.id, draft.id), eq(cases.statusCategory, 'draft')))
        .returning();
      if (!c) throw new AppError('CASE_STALE');
      await this.checkSubmission(tx, def, c);
      await this.linkFiles(c.id, def.requestForm, data, actor.userId);
      const run = this.newRun(tx, c, def);
      await this.event(run, { type: 'created' });
      await this.enter(run, def.start);
      await this.save(run);
      await this.outbox.emit('case.created', { caseId: c.id, requestType: c.requestType }, `case.created:${c.id}`);
      return run.c;
    });
  }

  /**
   * THS-10: the applicant cancels a draft, a case waiting for their revision, or a case whose
   * current step allows withdrawal.
   */
  async withdraw(caseId: string, reason: string): Promise<CaseRow> {
    const actor = this.actor();
    return this.db.run(async (tx) => {
      const [c] = await tx.select().from(cases).where(eq(cases.id, caseId)).limit(1);
      if (!c || c.applicantMembershipId !== actor.membershipId) throw new AppError('NOT_FOUND');
      const def = await this.definitionOf(tx, c.workflowVersionId);
      const allowed =
        c.statusCategory === 'draft' ||
        c.statusCategory === 'revising' ||
        (c.statusCategory === 'open' && c.currentSteps.some((id) => { const st = def.steps.find((x) => x.id === id); return st?.type === 'human' && st.allowWithdraw; }));
      if (!allowed) throw new AppError('INVALID_STATE_TRANSITION', { reason: 'withdraw_not_allowed' });
      const bumped = await tx
        .update(cases)
        .set({ lockVersion: sql`${cases.lockVersion} + 1` })
        .where(and(eq(cases.id, c.id), eq(cases.lockVersion, c.lockVersion)))
        .returning({ lockVersion: cases.lockVersion });
      if (!bumped.length) throw new AppError('CASE_STALE');
      const run = this.newRun(tx, { ...c, lockVersion: bumped[0]!.lockVersion }, def);
      run.c.currentSteps = [];
      await this.event(run, { type: 'withdrawn', publicNote: reason });
      await this.close(run, 'cancelled');
      await this.save(run);
      return run.c;
    });
  }

  /** Candidates for a member field of a request form (applicant side, THS-02/04). */
  async eligibleForRequest(requestType: string, field: string, unitId?: string, degree?: string) {
    const actor = this.actor();
    return this.db.run(async (tx) => {
      const unit = unitId ?? (await this.primaryUnit(tx, actor.membershipId));
      const unitPath = unit ? await this.unitPath(tx, unit) : null;
      const version = await this.pickVersion(tx, requestType, { degree, unitPath });
      const f = definitionSchema.parse(version.definition).requestForm.find((x) => x.key === field && x.type === 'member');
      if (!f?.eligibility) throw new AppError('NOT_FOUND');
      return this.eligible(tx, f, { unitId: unit, applicantMembershipId: actor.membershipId });
    });
  }

  /** Candidates for a member field of a step form, for whoever can act on that step now. */
  async eligibleForStep(caseId: string, stepId: string, field: string) {
    const actor = this.actor();
    return this.db.run(async (tx) => {
      const [c] = await tx.select().from(cases).where(eq(cases.id, caseId)).limit(1);
      if (!c) throw new AppError('NOT_FOUND');
      const tasks = await tx.select().from(caseTasks).where(and(eq(caseTasks.caseId, caseId), eq(caseTasks.stepId, stepId), eq(caseTasks.status, 'open')));
      let can = false;
      for (const t of tasks) if (await this.canAct(tx, c, t, actor.membershipId)) can = true;
      if (!can) throw new AppError('FORBIDDEN');
      const step = (await this.definitionOf(tx, c.workflowVersionId)).steps.find((s) => s.id === stepId);
      const f = step?.type === 'human' ? step.form.find((x) => x.key === field && x.type === 'member') : undefined;
      if (!f?.eligibility) throw new AppError('NOT_FOUND');
      return this.eligible(tx, f, { unitId: c.unitId, caseId: c.id, applicantMembershipId: c.applicantMembershipId });
    });
  }

  private async ownDraft(tx: Executor, caseId: string, membershipId: string): Promise<CaseRow> {
    const [c] = await tx.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    if (!c || c.applicantMembershipId !== membershipId) throw new AppError('NOT_FOUND');
    if (c.statusCategory !== 'draft') throw new AppError('INVALID_STATE_TRANSITION');
    return c;
  }

  /** Performs `action` on an open task (WF-04/05). */
  async act(caseId: string, taskId: string, input: ActInput): Promise<CaseRow> {
    const actor = this.actor();
    return this.db.run(async (tx) => {
      const { c, task } = await this.claim(tx, caseId, taskId, input.expectedVersion);
      await this.assertCanAct(tx, c, task, actor.membershipId);
      return this.perform(tx, c, task, input, actor.userId);
    });
  }

  /**
   * Sandbox run (WF-15): plays a draft version against a simulated case inside a savepoint that
   * is always rolled back, so nothing is stored and no notification leaves (outbox rows vanish).
   * Each script entry acts on the first open task offering that action.
   */
  async simulate(versionId: string, requestType: string, input: { data?: unknown; unitId?: string; script: SimStep[] }): Promise<SimResult> {
    const actor = this.actor();
    const ROLLBACK = new Error('simulation rollback');
    let result: SimResult | undefined;
    try {
      await this.db.savepoint(() =>
        this.db.run(async (tx) => {
          const def = await this.definitionOf(tx, versionId);
          let last: SimResult = { ok: true, status: 'open', path: [], open: [], data: {}, internal: {} };
          try {
            const unitId = input.unitId ?? (await this.primaryUnit(tx, actor.membershipId));
            const run = await this.createCase(tx, versionId, def, { requestType, unitId, data: assertCaseData(input.data), actor, sim: true });
            last = await this.snapshot(tx, run.c.id, def);
            for (const st of input.script) {
              const open = await tx.select().from(caseTasks).where(and(eq(caseTasks.caseId, run.c.id), eq(caseTasks.status, 'open'))).orderBy(caseTasks.createdAt);
              const task = open.find((t) =>
                t.assigneeType === 'applicant'
                  ? (APPLICANT_ACTIONS as readonly string[]).includes(st.action)
                  : (run.steps.get(t.stepId) as HumanStep | undefined)?.actions.includes(st.action),
              );
              if (!task) throw new AppError('INVALID_STATE_TRANSITION', { action: st.action, reason: 'no_open_task' });
              const claimed = await this.claim(tx, run.c.id, task.id);
              await this.perform(tx, claimed.c, claimed.task, { action: st.action, form: st.form, data: st.data }, actor.userId, true);
              last = await this.snapshot(tx, run.c.id, def);
            }
            result = last;
          } catch (e) {
            if (!(e instanceof AppError)) throw e;
            result = { ...last, ok: false, error: { code: e.code, message: e.message, details: e.details } };
          }
          throw ROLLBACK;
        }),
      );
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
    return result!;
  }

  private async snapshot(tx: Executor, caseId: string, def: WorkflowDefinition): Promise<SimResult> {
    const title = (id: string | null) => (!id ? null : id === BUILTIN_APPLICANT ? 'اصلاح توسط متقاضی' : (def.steps.find((s) => s.id === id)?.title ?? id));
    const [c] = await tx.select().from(cases).where(eq(cases.id, caseId));
    const events = await tx.select().from(caseEvents).where(eq(caseEvents.caseId, caseId)).orderBy(caseEvents.occurredAt);
    const open = await tx.select().from(caseTasks).where(and(eq(caseTasks.caseId, caseId), eq(caseTasks.status, 'open'))).orderBy(caseTasks.createdAt);
    return {
      ok: true,
      status: c!.statusCategory,
      path: events.map((e) => ({ type: e.type, step: title(e.stepId), action: e.action, toStep: title(e.toStep) })),
      open: open.map((t) => {
        const step = def.steps.find((s) => s.id === t.stepId);
        return {
          stepId: t.stepId,
          step: title(t.stepId)!,
          actions: t.assigneeType === 'applicant' ? [...APPLICANT_ACTIONS] : step?.type === 'human' ? step.actions : [],
          form: step?.type === 'human' ? step.form : [],
          assignee: t.assigneeType === 'role' ? `نقش ${t.roleKey}` : t.assigneeType === 'applicant' ? 'متقاضی' : 'شخص مشخص',
          dueAt: t.dueAt,
        };
      }),
      data: c!.data,
      internal: c!.internal,
    };
  }

  /** Creates the case row on a given version and runs it to its first waiting step (or keeps it as a draft). */
  private async createCase(
    tx: Executor,
    versionId: string,
    def: WorkflowDefinition,
    i: {
      requestType: string;
      title?: string;
      unitId: string | null;
      data: Record<string, unknown>;
      actor: { userId: string; membershipId: string; tenantId: string };
      sim?: boolean;
      draft?: boolean;
    },
  ): Promise<Run> {
    const fields = i.draft ? i.data : this.requestData(def, i.data);
    const [c] = await tx
      .insert(cases)
      .values({
        tenantId: i.actor.tenantId,
        workflowVersionId: versionId,
        requestType: i.requestType,
        title: i.title ?? null,
        applicantMembershipId: i.actor.membershipId,
        unitId: i.unitId,
        data: fields,
        statusCategory: i.draft ? 'draft' : 'open',
        submittedAt: i.draft ? null : new Date(),
      })
      .returning();
    const run = this.newRun(tx, c!, def);
    if (i.draft) return run;
    if (!i.sim) await this.checkSubmission(tx, def, run.c);
    if (!i.sim) await this.linkFiles(c!.id, def.requestForm, fields, i.actor.userId);
    await this.event(run, { type: 'created' });
    await this.enter(run, def.start);
    await this.save(run);
    return run;
  }

  /** THS-02/04/05/11: chosen members are eligible and have room; applicant limits hold. */
  private async checkSubmission(tx: Executor, def: WorkflowDefinition, c: CaseRow) {
    const active = await tx
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.applicantMembershipId, c.applicantMembershipId), eq(cases.requestType, c.requestType), inArray(cases.statusCategory, OPEN), sql`${cases.id} <> ${c.id}`))
      .limit(1);
    if (def.limits.onePerApplicant && active.length) throw new AppError('CASE_LIMIT', { caseId: active[0]!.id });
    if (def.limits.reapplyAfterDays > 0) {
      const [last] = await tx
        .select({ closedAt: cases.closedAt })
        .from(cases)
        .where(and(eq(cases.applicantMembershipId, c.applicantMembershipId), eq(cases.requestType, c.requestType), eq(cases.statusCategory, 'failure')))
        .orderBy(desc(cases.closedAt))
        .limit(1);
      const availableAt = last?.closedAt ? new Date(last.closedAt.getTime() + def.limits.reapplyAfterDays * 86_400_000) : null;
      if (availableAt && availableAt > new Date()) throw new AppError('REAPPLY_TOO_SOON', { availableAt: availableAt.toISOString() });
    }
    await this.checkMembers(tx, def.requestForm, c.data, c);
  }

  /** Member fields: every chosen member is eligible for the case unit and, with a capacity, not full. */
  async checkMembers(tx: Executor, fields: z.input<typeof formFieldSchema>[], values: Record<string, unknown>, c: Pick<CaseRow, 'id' | 'applicantMembershipId' | 'unitId'>) {
    for (const f of fields) {
      if (f.type !== 'member' || !f.eligibility) continue;
      const v = values[f.key];
      const ids = typeof v === 'string' ? [v] : Array.isArray(v) ? (v as string[]) : [];
      for (const id of ids) {
        if (id === c.applicantMembershipId) throw new AppError('SEPARATION_OF_DUTIES', { field: f.key });
        const [row] = await this.eligible(tx, f, { unitId: c.unitId, caseId: c.id, membershipId: id });
        if (!row) throw new AppError('MEMBER_NOT_ELIGIBLE', { fields: { [f.key]: 'not_eligible' } });
        if (row.full) throw new AppError('MEMBER_CAPACITY_FULL', { fields: { [f.key]: 'capacity_full' } });
      }
    }
  }

  /**
   * Members who may be chosen in a member field, with their current load (THS-02/04). Load counts
   * open cases (other than `caseId`) that name the member in the same field.
   */
  eligible(tx: Executor, f: z.input<typeof formFieldSchema>, o: { unitId: string | null; caseId?: string; membershipId?: string; applicantMembershipId?: string }) {
    const e = f.eligibility!;
    const key = f.key;
    return tx
      .execute<{ membership_id: string; full_name: string; unit_name: string | null; load: number; capacity: number | null; full: boolean }>(
        sql`
        select m.id as membership_id, u.full_name, ou.name_fa as unit_name, coalesce(l.load, 0)::int as load, cap.capacity,
               (cap.capacity is not null and coalesce(l.load, 0) >= cap.capacity) as full
        from memberships m
        join users u on u.id = m.user_id
        left join lateral (select mu.unit_id from membership_units mu where mu.membership_id = m.id order by mu.is_primary desc limit 1) pu on true
        left join org_units ou on ou.id = pu.unit_id
        cross join lateral (select ${f.capacity ? sql`coalesce((m.profile->>'supervisionCapacity')::int, ${f.capacity.default})` : sql`null::int`} as capacity) cap
        left join lateral (
          select count(*) as load from cases oc
          where oc.status_category in ('open', 'revising')
            and oc.id <> ${o.caseId ?? '00000000-0000-0000-0000-000000000000'}
            and (oc.data->>${key} = m.id::text or (jsonb_typeof(oc.data->${key}) = 'array' and oc.data->${key} ? m.id::text))
        ) l on true
        where m.status = 'active'
          ${o.membershipId ? sql`and m.id = ${o.membershipId}` : sql``}
          ${o.applicantMembershipId ? sql`and m.id <> ${o.applicantMembershipId}` : sql``}
          and ${memberCoverage(sql`m.id`, sql`${e.role}`, sql`${e.scope}`, sql`${o.unitId}::uuid`, sql`null::uuid`)}
        order by u.full_name
        limit 200`,
      )
      .then((r) => r.rows);
  }

  /** Applies one action to a claimed task (authorisation already checked by the caller). */
  private async perform(tx: Executor, c: CaseRow, task: TaskRow, input: ActInput, userId: string, sim = false): Promise<CaseRow> {
    const def = await this.definitionOf(tx, c.workflowVersionId);
    const run = this.newRun(tx, c, def);
    await this.completeTask(run, task, input.action, userId);

    if (task.assigneeType === 'applicant') {
      if (!(APPLICANT_ACTIONS as readonly string[]).includes(input.action)) throw new AppError('VALIDATION_FAILED', { field: 'action' });
      run.c.currentSteps = run.c.currentSteps.filter((s) => s !== BUILTIN_APPLICANT);
      if (input.action === 'withdraw') {
        await this.event(run, { type: 'withdrawn', stepId: BUILTIN_APPLICANT, publicNote: input.publicNote });
        await this.close(run, 'cancelled');
      } else {
        const patch = assertCaseData(input.data);
        if (def.requestForm.length) {
          // only request-form fields can be revised (THS-07: only the requested ones); the form must stay valid
          const allowed = task.revisionFields.length ? task.revisionFields : def.requestForm.map((f) => f.key);
          const blocked = Object.keys(patch).filter((k) => !allowed.includes(k));
          if (blocked.length) {
            const unknown = (k: string) => !def.requestForm.some((f) => f.key === k);
            throw new AppError('VALIDATION_FAILED', { fields: Object.fromEntries(blocked.map((k) => [k, unknown(k) ? 'unknown' : 'not_editable'])) });
          }
          const merged = { ...run.c.data, ...patch };
          this.requestData(def, Object.fromEntries(def.requestForm.filter((f) => f.key in merged).map((f) => [f.key, merged[f.key]])));
          await this.checkMembers(tx, def.requestForm, patch, run.c);
          if (!sim) await this.linkFiles(run.c.id, def.requestForm, patch, userId);
        }
        // keep the replaced values so earlier versions stay visible in the history
        const previous = Object.fromEntries(Object.keys(patch).filter((k) => k in run.c.data).map((k) => [k, run.c.data[k]]));
        run.c.data = { ...run.c.data, ...patch };
        assertCaseData(run.c.data);
        run.c.statusCategory = 'open';
        await this.event(run, { type: 'resubmitted', stepId: BUILTIN_APPLICANT, publicNote: input.publicNote, form: Object.keys(previous).length ? { previous } : undefined });
        await this.enter(run, task.returnTo!);
      }
    } else {
      const step = run.steps.get(task.stepId) as HumanStep | undefined;
      if (!step || step.type !== 'human') throw new AppError('INVALID_STATE_TRANSITION');
      if (!step.actions.includes(input.action)) throw new AppError('VALIDATION_FAILED', { field: 'action' });
      const form = validateForm(step.form, input.form);
      await this.checkMembers(tx, step.form, { ...form.public, ...form.internal }, run.c);
      if (!sim) await this.linkFiles(run.c.id, step.form, { ...form.public, ...form.internal }, userId);
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
        await this.follow(run, t, step.id, input.revision);
      }
    }
    await this.save(run);
    return run.c;
  }

  // ── engine internals ─────────────────────────────────────────────────────

  /** WF-10: with a request form, data must match it (unknown keys rejected); without one, free JSON. */
  private requestData(def: WorkflowDefinition, data: Record<string, unknown>): Record<string, unknown> {
    if (!def.requestForm.length) return data;
    const v = validateForm(def.requestForm, data);
    return { ...v.public, ...v.internal };
  }

  /** Attaches files uploaded for file fields to the case (only the actor's own, unlinked uploads). */
  async linkFiles(caseId: string, fields: { key: string; type: string }[], values: Record<string, unknown>, userId: string) {
    const ids = fields
      .filter((f) => f.type === 'file')
      .flatMap((f) => {
        const v = values[f.key];
        return typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      });
    if (ids.length) await this.files.link(ids, 'case', caseId, { userId });
  }

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

  private async follow(run: Run, t: Transition, from: string, revision?: ActInput['revision']): Promise<void> {
    if (t.to !== BUILTIN_APPLICANT) return this.enter(run, t.to);
    // return to the applicant for revision; resubmission re-enters the step that sent it back.
    // THS-07: the reviewer may name the fields to fix and a deadline
    const keys = new Set(run.def.requestForm.map((f) => f.key));
    const fields = (revision?.fields ?? []).filter((f) => keys.has(f));
    const dueAt = revision?.deadlineDays ? new Date(run.now.getTime() + revision.deadlineDays * 86_400_000) : null;
    const taskId = await this.createTask(run, { stepId: BUILTIN_APPLICANT, assigneeType: 'applicant', returnTo: from, revisionFields: fields, dueAt });
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
      case 'payment': {
        // the payments module creates the request; the case waits until it reports back
        run.c.currentSteps = [...run.c.currentSteps, stepId];
        await this.event(run, { type: 'entered', stepId });
        await this.outbox.emit(
          'workflow.payment',
          { caseId: run.c.id, stepId, serviceKey: step.serviceKey, deadlineDays: step.deadlineDays, applicantMembershipId: run.c.applicantMembershipId, title: step.title },
          `workflow.payment:${run.c.id}:${stepId}:${run.c.lockVersion}:${run.hops}`,
        );
        return;
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
      Partial<Pick<TaskRow, 'roleKey' | 'scope' | 'assigneeMembershipId' | 'returnTo' | 'dueAt' | 'slaSchedule' | 'slaNextAt' | 'revisionFields'>> & { parallelOf?: string },
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

  /**
   * PAY-06/08: the payment result moves a case waiting on a payment step. Idempotent — a case that
   * already left the step (repeated bank callback, reconciliation) is left alone.
   */
  async resumePayment(tx: Executor, caseId: string, stepId: string, outcome: 'paid' | 'unpaid'): Promise<boolean> {
    const [c] = await tx.select().from(cases).where(eq(cases.id, caseId)).for('update').limit(1);
    if (!c || !OPEN.includes(c.statusCategory) || !c.currentSteps.includes(stepId)) return false;
    await tx.update(cases).set({ lockVersion: sql`${cases.lockVersion} + 1` }).where(eq(cases.id, caseId));
    const run = this.newRun(tx, c, await this.definitionOf(tx, c.workflowVersionId));
    run.c.currentSteps = run.c.currentSteps.filter((s) => s !== stepId);
    await this.event(run, { type: 'system', stepId, action: outcome });
    await this.follow(run, this.pick(run, stepId, outcome), stepId);
    await this.save(run);
    return true;
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
    // most specific matching selector wins, then the newest (WF-07)
    const match = rows
      .map((r) => ({ r, sel: selectorSchema.parse(r.selector) }))
      .filter(({ sel }) => selectorMatches(sel, subject))
      .sort((a, b) => selectorSpecificity(b.sel) - selectorSpecificity(a.sel))[0]?.r;
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
