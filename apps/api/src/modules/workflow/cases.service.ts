import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { DbService, type Executor } from '../../database/db.service.js';
import { caseEvents, cases, caseTasks, memberships, orgUnits, users, workflows, workflowVersions, type CaseStatusCategory } from '../../database/schema.js';
import { AclService } from '../acl/acl.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { nextAt, slaSchedule } from './calendar.js';
import { BUILTIN_APPLICANT, definitionSchema, type WorkflowDefinition } from './definition.js';
import { roleCoverage, WorkflowEngine, type CaseRow } from './engine.service.js';

/** Event types the applicant sees in their history (internal routing/staff events are hidden). */
const PUBLIC_EVENTS = new Set(['created', 'entered', 'action', 'returned', 'resubmitted', 'withdrawn', 'closed']);

const stepTitle = (def: WorkflowDefinition, id: string | null) =>
  !id ? null : id === BUILTIN_APPLICANT ? 'اصلاح توسط متقاضی' : (def.steps.find((s) => s.id === id)?.title ?? id);

@Injectable()
export class CasesService {
  constructor(
    private readonly db: DbService,
    private readonly acl: AclService,
    private readonly audit: AuditService,
    private readonly engine: WorkflowEngine,
    private readonly outbox: OutboxService,
  ) {}

  private me() {
    const ctx = requestContext.get();
    return { membershipId: ctx.membershipId!, userId: ctx.userId! };
  }

  /** Case detail: applicant view for the owner, staff view for reviewers in scope (THS-08). */
  async get(caseId: string) {
    const me = this.me();
    return this.db.run(async (tx) => {
      const [c] = await tx.select().from(cases).where(eq(cases.id, caseId)).limit(1);
      if (!c) throw new AppError('NOT_FOUND');
      const def = await this.engine.definitionOf(tx, c.workflowVersionId);
      const [wf] = await tx
        .select({ name: workflows.nameFa })
        .from(workflowVersions)
        .innerJoin(workflows, eq(workflows.id, workflowVersions.workflowId))
        .where(eq(workflowVersions.id, c.workflowVersionId));
      const tasks = await tx.select().from(caseTasks).where(eq(caseTasks.caseId, c.id)).orderBy(asc(caseTasks.createdAt));
      const events = await tx
        .select({ e: caseEvents, actorName: users.fullName })
        .from(caseEvents)
        .leftJoin(users, eq(users.id, caseEvents.actorUserId))
        .where(eq(caseEvents.caseId, c.id))
        .orderBy(asc(caseEvents.occurredAt));
      const base = {
        id: c.id,
        title: c.title,
        requestType: c.requestType,
        workflowName: wf?.name ?? c.requestType,
        statusCategory: c.statusCategory,
        lockVersion: c.lockVersion,
        createdAt: c.createdAt,
        closedAt: c.closedAt,
        data: c.data,
        current: c.currentSteps.map((s) => ({ stepId: s, title: stepTitle(def, s) })),
      };

      if (c.applicantMembershipId === me.membershipId) {
        const revision = tasks.find((t) => t.status === 'open' && t.assigneeType === 'applicant');
        return {
          view: 'applicant' as const,
          ...base,
          revisionTaskId: revision?.id ?? null,
          history: events
            .filter(({ e }) => PUBLIC_EVENTS.has(e.type))
            .map(({ e }) => ({ type: e.type, occurredAt: e.occurredAt, step: stepTitle(def, e.stepId), action: e.action, note: e.publicNote })),
        };
      }

      const canAct = new Map<string, boolean>();
      for (const t of tasks) if (t.status === 'open') canAct.set(t.id, await this.engine.canAct(tx, c, t, me.membershipId));
      const involved = [...canAct.values()].some(Boolean) || tasks.some((t) => t.completedBy === me.userId);
      if (!involved && !(await this.acl.has('case.view.scope', { unitId: c.unitId, caseId: c.id }))) throw new AppError('NOT_FOUND');

      const [applicant] = await tx
        .select({ fullName: users.fullName, memberNo: memberships.memberNo, kind: memberships.kind })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.id, c.applicantMembershipId))
        .limit(1);
      const currentSteps = def.steps.filter((s) => c.currentSteps.includes(s.id));
      return {
        view: 'staff' as const,
        ...base,
        unitId: c.unitId,
        applicant,
        internal: c.internal,
        decisions: c.decisions,
        steps: currentSteps.map((s) => (s.type === 'human' ? { id: s.id, title: s.title, actions: s.actions, form: s.form } : { id: s.id, title: s.title })),
        tasks: tasks.map((t) => ({
          id: t.id,
          stepId: t.stepId,
          step: stepTitle(def, t.stepId),
          status: t.status,
          assigneeType: t.assigneeType,
          roleKey: t.roleKey,
          scope: t.scope,
          assigneeMembershipId: t.assigneeMembershipId,
          action: t.action,
          dueAt: t.dueAt,
          overdueAt: t.overdueAt,
          escalatedAt: t.escalatedAt,
          createdAt: t.createdAt,
          completedAt: t.completedAt,
          canAct: canAct.get(t.id) ?? false,
        })),
        history: events.map(({ e, actorName }) => ({
          type: e.type,
          occurredAt: e.occurredAt,
          stepId: e.stepId,
          step: stepTitle(def, e.stepId),
          action: e.action,
          toStep: stepTitle(def, e.toStep),
          actorName,
          publicNote: e.publicNote,
          internalNote: e.internalNote,
          form: e.form,
        })),
      };
    });
  }

  /** The applicant's own cases. */
  async mine(limit: number, offset: number) {
    const me = this.me();
    return this.db.run(async (tx) => {
      const where = eq(cases.applicantMembershipId, me.membershipId);
      const items = await this.listRows(tx, where, limit, offset);
      const [{ total }] = (await tx.select({ total: sql<number>`count(*)::int` }).from(cases).where(where)) as [{ total: number }];
      return { items, total };
    });
  }

  /** Staff list scoped by `case.view.scope` (ACL-05). */
  async list(q: { statusCategory?: CaseStatusCategory; requestType?: string; limit: number; offset: number }) {
    const filter = await this.acl.filterFor('case.view.scope');
    return this.db.run(async (tx) => {
      const scope = filter.all
        ? sql`true`
        : sql`(${AclService.unitPredicate(filter, cases.unitId, orgUnits.path)}${filter.caseIds.length ? sql` or ${inArray(cases.id, filter.caseIds)}` : sql``})`;
      const where = and(
        scope,
        q.statusCategory ? eq(cases.statusCategory, q.statusCategory) : undefined,
        q.requestType ? eq(cases.requestType, q.requestType) : undefined,
      );
      const items = await this.listRows(tx, where, q.limit, q.offset);
      const [{ total }] = (await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(cases)
        .leftJoin(orgUnits, eq(orgUnits.id, cases.unitId))
        .where(where)) as [{ total: number }];
      return { items, total };
    });
  }

  private listRows(tx: Executor, where: ReturnType<typeof and>, limit: number, offset: number) {
    return tx
      .select({
        id: cases.id,
        title: cases.title,
        requestType: cases.requestType,
        statusCategory: cases.statusCategory,
        currentSteps: cases.currentSteps,
        createdAt: cases.createdAt,
        updatedAt: cases.updatedAt,
        closedAt: cases.closedAt,
        workflowName: workflows.nameFa,
        unitNameFa: orgUnits.nameFa,
      })
      .from(cases)
      .innerJoin(workflowVersions, eq(workflowVersions.id, cases.workflowVersionId))
      .innerJoin(workflows, eq(workflows.id, workflowVersions.workflowId))
      .leftJoin(orgUnits, eq(orgUnits.id, cases.unitId))
      .where(where)
      .orderBy(desc(cases.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /** Cartable (UX-04): every open task the caller can act on, soonest due first. */
  async myTasks() {
    const me = this.me();
    return this.db.run(async (tx) => {
      const res = await tx.execute<{
        id: string;
        case_id: string;
        step_id: string;
        assignee_type: string;
        due_at: Date | null;
        overdue_at: Date | null;
        created_at: Date;
        title: string | null;
        request_type: string;
        status_category: string;
        workflow_name: string;
        definition: unknown;
        applicant_name: string;
        unit_name: string | null;
      }>(sql`
        select ct.id, ct.case_id, ct.step_id, ct.assignee_type, ct.due_at, ct.overdue_at, ct.created_at,
               c.title, c.request_type, c.status_category, w.name_fa as workflow_name, v.definition,
               u.full_name as applicant_name, ou.name_fa as unit_name
        from case_tasks ct
        join cases c on c.id = ct.case_id
        join workflow_versions v on v.id = c.workflow_version_id
        join workflows w on w.id = v.workflow_id
        join memberships m on m.id = c.applicant_membership_id
        join users u on u.id = m.user_id
        left join org_units ou on ou.id = c.unit_id
        where ct.status = 'open' and (
          (ct.assignee_type = 'applicant' and c.applicant_membership_id = ${me.membershipId})
          or (c.applicant_membership_id <> ${me.membershipId} and (
            (ct.assignee_type = 'membership' and ct.assignee_membership_id = ${me.membershipId})
            or (ct.assignee_type = 'role' and ${roleCoverage(me.membershipId)})
          ))
        )
        order by ct.due_at asc nulls last, ct.created_at asc
        limit 200`);
      const now = Date.now();
      return res.rows.map((r) => {
        const def = definitionSchema.safeParse(r.definition);
        const due = r.due_at ? new Date(r.due_at) : null;
        return {
          id: r.id,
          caseId: r.case_id,
          stepId: r.step_id,
          step: def.success ? stepTitle(def.data, r.step_id) : r.step_id,
          assigneeType: r.assignee_type,
          caseTitle: r.title,
          requestType: r.request_type,
          statusCategory: r.status_category,
          workflowName: r.workflow_name,
          applicantName: r.applicant_name,
          unitNameFa: r.unit_name,
          dueAt: due,
          overdue: !!r.overdue_at || (!!due && due.getTime() < now),
          createdAt: r.created_at,
        };
      });
    });
  }

  /** WF-12: hand a task to a specific member, with a reason. */
  async reassign(caseId: string, taskId: string, membershipId: string, reason: string) {
    return this.db.run(async (tx) => {
      const { c, task } = await this.engine.claim(tx, caseId, taskId);
      await this.acl.assert('case.assign', { unitId: c.unitId, caseId: c.id }, { type: 'case', id: c.id });
      if (task.assigneeType === 'applicant') throw new AppError('INVALID_STATE_TRANSITION');
      if (membershipId === c.applicantMembershipId) throw new AppError('SEPARATION_OF_DUTIES');
      const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.status, 'active'))).limit(1);
      if (!m) throw new AppError('ASSIGNEE_UNRESOLVED');
      const before = { assigneeType: task.assigneeType, roleKey: task.roleKey, assigneeMembershipId: task.assigneeMembershipId };
      await tx.update(caseTasks).set({ assigneeType: 'membership', roleKey: null, scope: null, assigneeMembershipId: m.id }).where(eq(caseTasks.id, task.id));
      await this.staffEvent(tx, c, { type: 'reassigned', stepId: task.stepId, internalNote: reason });
      await this.outbox.emit('case.task.assigned', { caseId: c.id, taskId: task.id }, `case.task.assigned:${task.id}:${c.lockVersion}`);
      await this.audit.record({ action: 'case.task.reassigned', targetType: 'case_task', targetId: task.id, before, after: { assigneeMembershipId: m.id }, reason });
      return { id: task.id, assigneeMembershipId: m.id };
    });
  }

  /** WF-23: extend a task's deadline, with a reason. */
  async extend(caseId: string, taskId: string, days: number, reason: string) {
    return this.db.run(async (tx) => {
      const { c, task } = await this.engine.claim(tx, caseId, taskId);
      await this.acl.assert('case.assign', { unitId: c.unitId, caseId: c.id }, { type: 'case', id: c.id });
      const now = new Date();
      const from = task.dueAt && task.dueAt > now ? task.dueAt : now;
      const dueAt = new Date(from.getTime() + days * 86_400_000);
      // reminders restart against the new deadline (WF-21)
      const def = await this.engine.definitionOf(tx, c.workflowVersionId);
      const step = def.steps.find((s) => s.id === task.stepId);
      const schedule = slaSchedule(dueAt, step?.type === 'human' ? step.sla : undefined, now);
      await tx.update(caseTasks).set({ dueAt, slaSchedule: schedule, slaNextAt: nextAt(schedule), overdueAt: null }).where(eq(caseTasks.id, task.id));
      await this.staffEvent(tx, c, { type: 'extended', stepId: task.stepId, internalNote: reason });
      await this.audit.record({ action: 'case.task.extended', targetType: 'case_task', targetId: task.id, before: { dueAt: task.dueAt }, after: { dueAt }, reason });
      return { id: task.id, dueAt };
    });
  }

  private async staffEvent(tx: Executor, c: CaseRow, e: { type: string; stepId: string; internalNote: string }) {
    const me = this.me();
    await tx.insert(caseEvents).values({ tenantId: c.tenantId, caseId: c.id, actorUserId: me.userId, actorMembershipId: me.membershipId, ...e });
  }
}
