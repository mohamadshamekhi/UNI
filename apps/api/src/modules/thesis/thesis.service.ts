import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { DbService, type Executor } from '../../database/db.service.js';
import { caseEvents, cases, caseTasks, theses, type ThesisStatus } from '../../database/schema.js';
import { AclService } from '../acl/acl.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { WorkflowEngine } from '../workflow/engine.service.js';

const STATUSES: ThesisStatus[] = ['proposal', 'in_progress', 'defense_scheduled', 'defended', 'failed', 'cancelled'];

/** Usual Iranian grading scale for a thesis defense. */
export function gradeLabel(grade: number | null): string | null {
  if (grade === null) return null;
  if (grade >= 19) return 'عالی';
  if (grade >= 17) return 'بسیار خوب';
  if (grade >= 15) return 'خوب';
  if (grade >= 14) return 'قابل قبول';
  return 'مردود';
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const uuids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);

/**
 * Thesis record (پرونده تحصیلی, section 8). Kept in sync from case data by `system` steps with
 * task `thesis` (params.status), so universities model the lifecycle with ordinary steps and forms.
 */
@Injectable()
export class ThesisService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly acl: AclService,
    private readonly audit: AuditService,
    private readonly engine: WorkflowEngine,
  ) {}

  onModuleInit() {
    this.outbox.on('workflow.thesis', async ({ tenantId, payload }) => {
      if (!tenantId) return;
      const status = (payload.params as { status?: string } | undefined)?.status;
      await this.db.withTenant(tenantId, (tx) => this.sync(tx, payload.caseId as string, STATUSES.includes(status as ThesisStatus) ? (status as ThesisStatus) : undefined));
    });
    // a thesis case that ends badly marks its record accordingly
    this.outbox.on('case.closed', async ({ tenantId, payload }) => {
      if (!tenantId || (payload.outcome !== 'failure' && payload.outcome !== 'cancelled')) return;
      await this.db.withTenant(tenantId, (tx) =>
        tx
          .update(theses)
          .set({ status: payload.outcome === 'failure' ? 'failed' : 'cancelled', updatedAt: new Date() })
          .where(and(eq(theses.caseId, payload.caseId as string), sql`${theses.status} not in ('defended', 'failed', 'cancelled')`)),
      );
    });
  }

  /** Upserts the record from the case (data first, then staff-only values such as the grade). */
  async sync(tx: Executor, caseId: string, status?: ThesisStatus) {
    const [c] = await tx.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    if (!c) return;
    const v = { ...c.internal, ...c.data };
    const grade = typeof v.grade === 'number' ? v.grade : typeof v.grade === 'string' && v.grade.trim() ? Number(v.grade) : null;
    const defenseAt = str(v.defenseAt);
    const values = {
      titleFa: str(v.title) ?? c.title ?? 'بدون عنوان',
      titleEn: str(v.titleEn),
      degree: str(v.degree),
      researchType: str(v.researchType),
      advisorMembershipId: str(v.advisorId),
      coAdvisorMembershipId: str(v.coAdvisorId),
      reviewerMembershipIds: uuids(v.reviewers),
      defenseAt: defenseAt && !Number.isNaN(Date.parse(defenseAt)) ? new Date(defenseAt) : null,
      defensePlace: str(v.defensePlace),
      grade: grade !== null && Number.isFinite(grade) ? grade.toFixed(2) : null,
      updatedAt: new Date(),
      ...(status ? { status } : {}),
    };
    await tx
      .insert(theses)
      .values({ tenantId: c.tenantId, caseId: c.id, studentMembershipId: c.applicantMembershipId, unitId: c.unitId, ...values })
      .onConflictDoUpdate({ target: theses.caseId, set: values });
  }

  private row = sql`
    select t.id, t.case_id, t.title_fa, t.title_en, t.degree, t.research_type, t.status, t.defense_at, t.defense_place,
           t.grade::float as grade, t.created_at, t.updated_at, t.unit_id, ou.name_fa as unit_name,
           t.student_membership_id, su.full_name as student_name, sm.member_no as student_no,
           t.advisor_membership_id, au.full_name as advisor_name,
           t.co_advisor_membership_id, cu.full_name as co_advisor_name,
           t.reviewer_membership_ids,
           (select coalesce(array_agg(ru.full_name order by ru.full_name), '{}') from memberships rm join users ru on ru.id = rm.user_id
             where rm.id = any(t.reviewer_membership_ids)) as reviewer_names
    from theses t
    join memberships sm on sm.id = t.student_membership_id join users su on su.id = sm.user_id
    left join memberships am on am.id = t.advisor_membership_id left join users au on au.id = am.user_id
    left join memberships cm on cm.id = t.co_advisor_membership_id left join users cu on cu.id = cm.user_id
    left join org_units ou on ou.id = t.unit_id`;

  private shape = (r: Record<string, unknown>) => ({
    id: r.id as string,
    caseId: r.case_id as string,
    titleFa: r.title_fa as string,
    titleEn: r.title_en as string | null,
    degree: r.degree as string | null,
    researchType: r.research_type as string | null,
    status: r.status as ThesisStatus,
    defenseAt: r.defense_at,
    defensePlace: r.defense_place as string | null,
    grade: r.grade as number | null,
    gradeLabel: gradeLabel(r.grade as number | null),
    unitNameFa: r.unit_name as string | null,
    student: { membershipId: r.student_membership_id as string, fullName: r.student_name as string, memberNo: r.student_no as string | null },
    advisor: r.advisor_membership_id ? { membershipId: r.advisor_membership_id as string, fullName: r.advisor_name as string } : null,
    coAdvisor: r.co_advisor_membership_id ? { membershipId: r.co_advisor_membership_id as string, fullName: r.co_advisor_name as string } : null,
    reviewers: (r.reviewer_names as string[]) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  /** The student's own theses (portal «پرونده تحصیلی»). */
  mine() {
    const me = requestContext.get().membershipId!;
    return this.db.run(async (tx) => (await tx.execute(sql`${this.row} where t.student_membership_id = ${me} order by t.created_at desc`)).rows.map(this.shape));
  }

  /** Theses the caller supervises, co-supervises or reviews. */
  supervisions() {
    const me = requestContext.get().membershipId!;
    return this.db.run(async (tx) => {
      const rows = (
        await tx.execute(sql`${this.row}
          where t.advisor_membership_id = ${me} or t.co_advisor_membership_id = ${me} or ${me}::uuid = any(t.reviewer_membership_ids)
          order by t.status, t.updated_at desc`)
      ).rows;
      return rows.map((r) => ({
        ...this.shape(r),
        myRole: r.advisor_membership_id === me ? 'advisor' : r.co_advisor_membership_id === me ? 'co_advisor' : 'reviewer',
      }));
    });
  }

  /** Staff list scoped like cases (case.view.scope). */
  async list(q: { status?: ThesisStatus; q?: string; limit: number; offset: number }) {
    const filter = await this.acl.filterFor('case.view.scope');
    return this.db.run(async (tx) => {
      const scope = filter.all
        ? sql`true`
        : AclService.unitPredicate(filter, sql`t.unit_id`, sql`ou.path`);
      const where = sql`where ${scope} ${q.status ? sql`and t.status = ${q.status}` : sql``} ${q.q ? sql`and (t.title_fa ilike ${'%' + q.q + '%'} or su.full_name ilike ${'%' + q.q + '%'})` : sql``}`;
      const items = (await tx.execute(sql`${this.row} ${where} order by t.updated_at desc limit ${q.limit} offset ${q.offset}`)).rows.map(this.shape);
      const total = (
        await tx.execute<{ n: number }>(sql`select count(*)::int as n from theses t
          join memberships sm on sm.id = t.student_membership_id join users su on su.id = sm.user_id
          left join org_units ou on ou.id = t.unit_id ${where}`)
      ).rows[0]!.n;
      return { items, total };
    });
  }

  /** THS-09: change the advisor of a thesis case (with a reason); open advisor tasks move along. */
  async changeAdvisor(caseId: string, membershipId: string, reason: string) {
    const ctx = requestContext.get();
    return this.db.run(async (tx) => {
      const [c] = await tx.select().from(cases).where(eq(cases.id, caseId)).limit(1);
      if (!c || c.statusCategory === 'draft') throw new AppError('NOT_FOUND');
      await this.acl.assert('case.assign', { unitId: c.unitId, caseId: c.id }, { type: 'case', id: c.id });
      const def = await this.engine.definitionOf(tx, c.workflowVersionId);
      const field = def.requestForm.find((f) => f.key === 'advisorId');
      if (!field) throw new AppError('INVALID_STATE_TRANSITION', { reason: 'no_advisor_field' });
      await this.engine.checkMembers(tx, [field], { advisorId: membershipId }, c);
      const old = typeof c.data.advisorId === 'string' ? c.data.advisorId : null;
      await tx.update(cases).set({ data: { ...c.data, advisorId: membershipId }, lockVersion: sql`${cases.lockVersion} + 1`, updatedAt: new Date() }).where(eq(cases.id, c.id));
      await tx.update(theses).set({ advisorMembershipId: membershipId, updatedAt: new Date() }).where(eq(theses.caseId, c.id));
      const moved = old
        ? await tx
            .update(caseTasks)
            .set({ assigneeMembershipId: membershipId })
            .where(and(eq(caseTasks.caseId, c.id), eq(caseTasks.status, 'open'), eq(caseTasks.assigneeType, 'membership'), eq(caseTasks.assigneeMembershipId, old)))
            .returning({ id: caseTasks.id })
        : [];
      await tx.insert(caseEvents).values({ tenantId: c.tenantId, caseId: c.id, actorUserId: ctx.userId, actorMembershipId: ctx.membershipId, type: 'advisor_changed', internalNote: reason });
      for (const m of moved) await this.outbox.emit('case.task.assigned', { caseId: c.id, taskId: m.id }, `case.task.assigned:${m.id}:advisor:${Date.now()}`);
      await this.audit.record({ action: 'thesis.advisor.changed', targetType: 'case', targetId: c.id, before: { advisorMembershipId: old }, after: { advisorMembershipId: membershipId }, reason });
      return { caseId: c.id, advisorMembershipId: membershipId, movedTasks: moved.length };
    });
  }

  /** Latest thesis of a case (for the case pages). */
  async byCase(caseId: string) {
    return this.db.run(async (tx) => {
      const r = (await tx.execute(sql`${this.row} where t.case_id = ${caseId} limit 1`)).rows[0];
      return r ? this.shape(r) : null;
    });
  }

  static readonly STATUSES = STATUSES;
}
