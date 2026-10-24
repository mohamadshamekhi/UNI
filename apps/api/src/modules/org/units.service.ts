import { Injectable } from '@nestjs/common';
import { and, asc, eq, like, sql } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { normalizeFa } from '../../common/util/normalize.js';
import { DbService, type Executor } from '../../database/db.service.js';
import { membershipUnits, memberships, orgUnits, orgUnitTypes } from '../../database/schema.js';
import { AuditService } from '../audit/audit.service.js';

export interface UnitInput {
  parentId?: string | null;
  typeId: string;
  nameFa: string;
  nameEn?: string;
  code?: string;
}

export interface UnitNode {
  id: string;
  parentId: string | null;
  typeId: string;
  nameFa: string;
  nameEn: string | null;
  code: string | null;
  depth: number;
  status: 'active' | 'archived';
  children: UnitNode[];
}

/** Organisation tree (TEN-11..14): configurable unit types instead of fixed levels. */
@Injectable()
export class UnitsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private tenantId() {
    return requestContext.get().tenant!.id;
  }

  // ------------------------------------------------------------------ unit types
  listTypes() {
    return this.db.run((tx) => tx.select().from(orgUnitTypes).orderBy(asc(orgUnitTypes.createdAt)));
  }

  async createType(input: { key: string; nameFa: string; nameEn?: string; isFacultyLevel?: boolean }) {
    const [row] = await this.db.run((tx) =>
      tx
        .insert(orgUnitTypes)
        .values({ tenantId: this.tenantId(), key: input.key, nameFa: normalizeFa(input.nameFa), nameEn: input.nameEn, isFacultyLevel: input.isFacultyLevel ?? false })
        .onConflictDoNothing()
        .returning(),
    );
    if (!row) throw new AppError('CONFLICT', { field: 'key' });
    await this.audit.record({ action: 'unit_type.created', targetType: 'unit_type', targetId: row.id, after: row });
    return row;
  }

  // ------------------------------------------------------------------ units
  async tree(opts: { includeArchived?: boolean } = {}): Promise<UnitNode[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(orgUnits)
        .where(opts.includeArchived ? undefined : eq(orgUnits.status, 'active'))
        .orderBy(asc(orgUnits.depth), asc(orgUnits.nameFa)),
    );
    const byId = new Map<string, UnitNode>();
    const roots: UnitNode[] = [];
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        parentId: r.parentId,
        typeId: r.typeId,
        nameFa: r.nameFa,
        nameEn: r.nameEn,
        code: r.code,
        depth: r.depth,
        status: r.status,
        children: [],
      });
    }
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      (parent ? parent.children : roots).push(node);
    }
    return roots;
  }

  async get(id: string, tx?: Executor) {
    const query = (t: Executor) => t.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1);
    const [u] = tx ? await query(tx) : await this.db.run(query);
    if (!u) throw new AppError('NOT_FOUND');
    return u;
  }

  /**
   * TEN-12: top-level units must be of a faculty-level type; deeper levels are free-form.
   */
  async create(input: UnitInput) {
    const tenantId = this.tenantId();
    return this.db.run(async (tx) => {
      const [type] = await tx.select().from(orgUnitTypes).where(eq(orgUnitTypes.id, input.typeId));
      if (!type) throw new AppError('UNIT_INVALID', { field: 'typeId' });
      const parent = input.parentId ? await this.get(input.parentId, tx) : null;
      if (parent && parent.status !== 'active') throw new AppError('UNIT_INVALID', { field: 'parentId' });
      if (!parent && !type.isFacultyLevel) throw new AppError('UNIT_INVALID', { reason: 'top_level_must_be_faculty' });

      const id = crypto.randomUUID();
      const [unit] = await tx
        .insert(orgUnits)
        .values({
          id,
          tenantId,
          parentId: parent?.id ?? null,
          typeId: type.id,
          nameFa: normalizeFa(input.nameFa),
          nameEn: input.nameEn,
          code: input.code,
          path: `${parent?.path ?? '/'}${id}/`,
          depth: (parent?.depth ?? 0) + 1,
        })
        .returning();
      await this.audit.record({ action: 'unit.created', targetType: 'unit', targetId: id, after: unit });
      return unit!;
    });
  }

  async update(id: string, patch: { nameFa?: string; nameEn?: string; code?: string | null }) {
    return this.db.run(async (tx) => {
      const before = await this.get(id, tx);
      const [after] = await tx
        .update(orgUnits)
        .set({
          nameFa: patch.nameFa ? normalizeFa(patch.nameFa) : before.nameFa,
          nameEn: patch.nameEn ?? before.nameEn,
          code: patch.code === undefined ? before.code : patch.code,
          updatedAt: new Date(),
        })
        .where(eq(orgUnits.id, id))
        .returning();
      await this.audit.record({ action: 'unit.updated', targetType: 'unit', targetId: id, before, after });
      return after!;
    });
  }

  /** Moves a unit (and its subtree) under a new parent; rewrites materialized paths. */
  async move(id: string, newParentId: string | null, reason: string) {
    return this.db.run(async (tx) => {
      const unit = await this.get(id, tx);
      const parent = newParentId ? await this.get(newParentId, tx) : null;
      if (parent?.path.startsWith(unit.path)) throw new AppError('UNIT_INVALID', { reason: 'cycle' });
      if (!parent) {
        const [type] = await tx.select().from(orgUnitTypes).where(eq(orgUnitTypes.id, unit.typeId));
        if (!type?.isFacultyLevel) throw new AppError('UNIT_INVALID', { reason: 'top_level_must_be_faculty' });
      }
      const newPath = `${parent?.path ?? '/'}${unit.id}/`;
      const depthDelta = (parent?.depth ?? 0) + 1 - unit.depth;
      await tx
        .update(orgUnits)
        .set({
          path: sql`${newPath} || substr(${orgUnits.path}, ${unit.path.length + 1})`,
          depth: sql`${orgUnits.depth} + ${depthDelta}`,
          updatedAt: new Date(),
        })
        .where(like(orgUnits.path, `${unit.path}%`));
      await tx.update(orgUnits).set({ parentId: parent?.id ?? null }).where(eq(orgUnits.id, unit.id));
      await this.audit.record({ action: 'unit.moved', targetType: 'unit', targetId: id, before: { parentId: unit.parentId }, after: { parentId: parent?.id ?? null }, reason });
      return this.get(id, tx);
    });
  }

  /** Soft archive only; blocked while active members or sub-units remain attached. */
  async archive(id: string, reason: string) {
    return this.db.run(async (tx) => {
      const unit = await this.get(id, tx);
      const [children] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(orgUnits)
        .where(and(eq(orgUnits.parentId, id), eq(orgUnits.status, 'active')));
      const [members] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(membershipUnits)
        .innerJoin(memberships, eq(memberships.id, membershipUnits.membershipId))
        .where(and(eq(membershipUnits.unitId, id), eq(memberships.status, 'active')));
      if ((children?.n ?? 0) > 0 || (members?.n ?? 0) > 0) {
        throw new AppError('CONFLICT', { activeChildren: children?.n ?? 0, activeMembers: members?.n ?? 0 });
      }
      await tx.update(orgUnits).set({ status: 'archived', updatedAt: new Date() }).where(eq(orgUnits.id, id));
      await this.audit.record({ action: 'unit.archived', targetType: 'unit', targetId: id, before: unit, reason });
    });
  }
}
