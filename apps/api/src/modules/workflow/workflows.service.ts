import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { DbService, type Executor } from '../../database/db.service.js';
import { cases, roles, workflows, workflowVersions } from '../../database/schema.js';
import { AuditService } from '../audit/audit.service.js';
import { selectorSchema, type Selector } from './definition.js';
import { selectorsOverlap, validateDefinition } from './validate.js';

type VersionRow = typeof workflowVersions.$inferSelect;

const EMPTY_DEFINITION = {
  start: 'review',
  steps: [
    { id: 'review', type: 'human', title: 'بررسی', assignee: { role: 'expert', scope: 'case_unit_tree' }, actions: ['approve', 'reject'] },
    { id: 'done', type: 'end', title: 'تأیید', outcome: 'success' },
    { id: 'rejected', type: 'end', title: 'رد', outcome: 'failure' },
  ],
  transitions: [
    { from: 'review', action: 'approve', to: 'done' },
    { from: 'review', action: 'reject', to: 'rejected' },
  ],
};

/** Workflow definitions and their versions (WF-02/06/08/14/16). Published versions are frozen. */
@Injectable()
export class WorkflowsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.db.run((tx) =>
      tx
        .select({
          id: workflows.id,
          key: workflows.key,
          nameFa: workflows.nameFa,
          requestType: workflows.requestType,
          description: workflows.description,
          createdAt: workflows.createdAt,
          publishedVersion: sql<number | null>`(select max(v.version) from workflow_versions v where v.workflow_id = ${workflows.id} and v.status = 'published')`,
          latestVersion: sql<number | null>`(select max(v.version) from workflow_versions v where v.workflow_id = ${workflows.id})`,
        })
        .from(workflows)
        .where(isNull(workflows.archivedAt))
        .orderBy(workflows.nameFa),
    );
  }

  /** Request types an applicant can start now: workflows with a published version. */
  requestTypes() {
    return this.db.run((tx) =>
      tx
        .selectDistinctOn([workflows.requestType], { requestType: workflows.requestType, nameFa: workflows.nameFa, description: workflows.description })
        .from(workflows)
        .innerJoin(workflowVersions, and(eq(workflowVersions.workflowId, workflows.id), eq(workflowVersions.status, 'published')))
        .where(isNull(workflows.archivedAt))
        .orderBy(workflows.requestType),
    );
  }

  async create(input: { key: string; nameFa: string; requestType: string; description?: string }) {
    const tenantId = requestContext.get().tenant!.id;
    return this.db.run(async (tx) => {
      const [dup] = await tx.select({ id: workflows.id }).from(workflows).where(eq(workflows.key, input.key)).limit(1);
      if (dup) throw new AppError('CONFLICT', { field: 'key' });
      const [w] = await tx.insert(workflows).values({ tenantId, ...input }).returning();
      await tx.insert(workflowVersions).values({
        tenantId,
        workflowId: w!.id,
        version: 1,
        definition: EMPTY_DEFINITION,
        selector: { requestType: input.requestType },
        createdBy: requestContext.get().userId,
      });
      await this.audit.record({ action: 'workflow.created', targetType: 'workflow', targetId: w!.id, after: input });
      return w!;
    });
  }

  async get(id: string) {
    return this.db.run(async (tx) => {
      const [w] = await tx.select().from(workflows).where(eq(workflows.id, id)).limit(1);
      if (!w) throw new AppError('NOT_FOUND');
      const versions = await tx
        .select({
          id: workflowVersions.id,
          version: workflowVersions.version,
          status: workflowVersions.status,
          createdAt: workflowVersions.createdAt,
          publishedAt: workflowVersions.publishedAt,
          retiredAt: workflowVersions.retiredAt,
          openCases: sql<number>`(select count(*)::int from cases c where c.workflow_version_id = ${workflowVersions.id} and c.status_category in ('open', 'revising'))`,
        })
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, id))
        .orderBy(desc(workflowVersions.version));
      return { ...w, versions };
    });
  }

  async getVersion(id: string) {
    return this.db.run((tx) => this.version(tx, id));
  }

  /** New draft, copied from the latest version unless a definition is given (WF-06). */
  async newVersion(workflowId: string, input: { definition?: unknown; selector?: unknown }) {
    return this.db.run(async (tx) => {
      const [w] = await tx.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
      if (!w) throw new AppError('NOT_FOUND');
      const [latest] = await tx.select().from(workflowVersions).where(eq(workflowVersions.workflowId, workflowId)).orderBy(desc(workflowVersions.version)).limit(1);
      const [v] = await tx
        .insert(workflowVersions)
        .values({
          tenantId: w.tenantId,
          workflowId,
          version: (latest?.version ?? 0) + 1,
          definition: input.definition ?? latest?.definition ?? EMPTY_DEFINITION,
          selector: this.selector(input.selector ?? latest?.selector, w.requestType),
          createdBy: requestContext.get().userId,
        })
        .returning();
      return v!;
    });
  }

  async updateVersion(id: string, input: { definition?: unknown; selector?: unknown }) {
    return this.db.run(async (tx) => {
      const v = await this.version(tx, id);
      if (v.status === 'published' || v.status === 'retired') throw new AppError('WORKFLOW_VERSION_LOCKED');
      const requestType = await this.requestTypeOf(tx, v.workflowId);
      const [u] = await tx
        .update(workflowVersions)
        .set({
          definition: input.definition ?? v.definition,
          selector: input.selector === undefined ? v.selector : this.selector(input.selector, requestType),
          status: 'draft',
          issues: [],
        })
        .where(eq(workflowVersions.id, id))
        .returning();
      return u!;
    });
  }

  /** WF-14: full validation report; a clean draft becomes `validated`. */
  async validate(id: string) {
    return this.db.run(async (tx) => {
      const v = await this.version(tx, id);
      const result = await this.check(tx, v);
      if (v.status === 'draft' || v.status === 'validated') {
        await tx.update(workflowVersions).set({ issues: result.issues, status: result.ok ? 'validated' : 'draft' }).where(eq(workflowVersions.id, id));
      }
      return { ok: result.ok, issues: result.issues };
    });
  }

  /** WF-16: what publishing this version would affect. */
  async impact(id: string) {
    return this.db.run(async (tx) => {
      const v = await this.version(tx, id);
      const current = await tx
        .select({ id: workflowVersions.id, version: workflowVersions.version })
        .from(workflowVersions)
        .where(and(eq(workflowVersions.workflowId, v.workflowId), eq(workflowVersions.status, 'published')));
      const [{ open }] = current.length
        ? ((await tx
            .select({ open: sql<number>`count(*)::int` })
            .from(cases)
            .where(and(inArray(cases.workflowVersionId, current.map((x) => x.id)), inArray(cases.statusCategory, ['open', 'revising'])))) as [{ open: number }])
        : [{ open: 0 }];
      return {
        replaces: current.map((x) => x.version),
        // running cases stay on their pinned version (WF-06); only new cases use the new one
        openCasesOnPrevious: open,
        conflicts: await this.overlapping(tx, v),
      };
    });
  }

  async publish(id: string) {
    const userId = requestContext.get().userId!;
    return this.db.run(async (tx) => {
      const v = await this.version(tx, id);
      if (v.status !== 'validated') throw new AppError('INVALID_STATE_TRANSITION', { status: v.status });
      const result = await this.check(tx, v);
      if (!result.ok) throw new AppError('WORKFLOW_INVALID', { issues: result.issues });
      const conflicts = await this.overlapping(tx, v);
      if (conflicts.length) throw new AppError('SELECTOR_OVERLAP', { conflicts });
      const now = new Date();
      const retired = await tx
        .update(workflowVersions)
        .set({ status: 'retired', retiredAt: now })
        .where(and(eq(workflowVersions.workflowId, v.workflowId), eq(workflowVersions.status, 'published')))
        .returning({ version: workflowVersions.version });
      const [p] = await tx
        .update(workflowVersions)
        .set({ status: 'published', publishedAt: now, publishedBy: userId, issues: [] })
        .where(eq(workflowVersions.id, id))
        .returning();
      await this.audit.record({
        action: 'workflow.published',
        targetType: 'workflow_version',
        targetId: id,
        before: { retired: retired.map((r) => r.version) },
        after: { workflowId: v.workflowId, version: v.version, selector: v.selector },
      });
      return p!;
    });
  }

  async retire(id: string, reason: string) {
    return this.db.run(async (tx) => {
      const v = await this.version(tx, id);
      if (v.status !== 'published') throw new AppError('INVALID_STATE_TRANSITION', { status: v.status });
      const [r] = await tx.update(workflowVersions).set({ status: 'retired', retiredAt: new Date() }).where(eq(workflowVersions.id, id)).returning();
      await this.audit.record({ action: 'workflow.retired', targetType: 'workflow_version', targetId: id, reason });
      return r!;
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async version(tx: Executor, id: string): Promise<VersionRow> {
    const [v] = await tx.select().from(workflowVersions).where(eq(workflowVersions.id, id)).limit(1);
    if (!v) throw new AppError('NOT_FOUND');
    return v;
  }

  private async requestTypeOf(tx: Executor, workflowId: string) {
    const [w] = await tx.select({ requestType: workflows.requestType }).from(workflows).where(eq(workflows.id, workflowId)).limit(1);
    return w!.requestType;
  }

  /** Selectors always target the workflow's own request type. */
  private selector(raw: unknown, requestType: string): Selector {
    const parsed = selectorSchema.safeParse({ ...((raw as object) ?? {}), requestType });
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', { field: 'selector' });
    return parsed.data;
  }

  private async check(tx: Executor, v: VersionRow) {
    const rows = await tx.select({ key: roles.key }).from(roles).where(and(eq(roles.tenantId, v.tenantId), isNull(roles.archivedAt)));
    return validateDefinition(v.definition, { roleKeys: new Set(rows.map((r) => r.key)) });
  }

  /** WF-08: other workflows' published versions whose selectors would also match. */
  private async overlapping(tx: Executor, v: VersionRow) {
    const sel = selectorSchema.parse(v.selector);
    const others = await tx
      .select({ id: workflowVersions.id, version: workflowVersions.version, selector: workflowVersions.selector, workflow: workflows.nameFa })
      .from(workflowVersions)
      .innerJoin(workflows, eq(workflows.id, workflowVersions.workflowId))
      .where(and(eq(workflowVersions.status, 'published'), ne(workflowVersions.workflowId, v.workflowId), eq(workflows.requestType, sel.requestType)));
    return others.filter((o) => selectorsOverlap(sel, selectorSchema.parse(o.selector))).map((o) => ({ versionId: o.id, version: o.version, workflow: o.workflow }));
  }
}
