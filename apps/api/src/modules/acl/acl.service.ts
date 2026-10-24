import { Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { requestContext, type RequestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { DbService } from '../../database/db.service.js';
import { orgUnits, roleAssignments, rolePermissions, roles, type ScopeType } from '../../database/schema.js';
import { AuditService } from '../audit/audit.service.js';
import type { PermissionCode } from './permissions.catalog.js';

export interface Grant {
  permission: PermissionCode;
  scopeType: ScopeType;
  scopeId: string | null;
  /** Materialized path of the scope unit (unit / unit_tree scopes). */
  unitPath: string | null;
}

export interface ResourceScope {
  unitId?: string | null;
  caseId?: string | null;
}

export type UnitFilter = { all: true } | { all: false; unitIds: string[]; treePaths: string[]; caseIds: string[] };

const grantsCache = new WeakMap<RequestContext, Promise<Grant[]>>();

/**
 * Access decision path (section 5, steps 3–6): valid assignments → permissions → scope match.
 * Default is deny. Steps 1–2 (identity, tenant, membership) happen in the guards.
 */
@Injectable()
export class AclService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Active grants for the current membership; memoized per request. */
  grants(): Promise<Grant[]> {
    const ctx = requestContext.get();
    if (!ctx.membershipId || ctx.membershipStatus !== 'active') return Promise.resolve([]);
    let cached = grantsCache.get(ctx);
    if (!cached) {
      cached = this.loadGrants(ctx.membershipId);
      grantsCache.set(ctx, cached);
    }
    return cached;
  }

  async loadGrants(membershipId: string, at = new Date()): Promise<Grant[]> {
    return this.db.run(async (tx) => {
      const rows = await tx
        .select({
          permission: rolePermissions.permissionCode,
          scopeType: roleAssignments.scopeType,
          scopeId: roleAssignments.scopeId,
          unitPath: orgUnits.path,
        })
        .from(roleAssignments)
        .innerJoin(roles, and(eq(roles.id, roleAssignments.roleId), isNull(roles.archivedAt)))
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .leftJoin(
          orgUnits,
          and(
            inArray(roleAssignments.scopeType, ['unit', 'unit_tree']),
            eq(orgUnits.id, roleAssignments.scopeId),
          ),
        )
        .where(
          and(
            eq(roleAssignments.membershipId, membershipId),
            isNull(roleAssignments.revokedAt),
            lte(roleAssignments.validFrom, at),
            or(isNull(roleAssignments.validTo), gt(roleAssignments.validTo, at)),
          ),
        );
      return rows as Grant[];
    });
  }

  private async unitPath(unitId: string): Promise<string | null> {
    const [row] = await this.db.run((tx) =>
      tx.select({ path: orgUnits.path }).from(orgUnits).where(eq(orgUnits.id, unitId)).limit(1),
    );
    return row?.path ?? null;
  }

  static covers(grant: Grant, resource: ResourceScope, resourceUnitPath: string | null): boolean {
    switch (grant.scopeType) {
      case 'tenant':
        return true;
      case 'unit':
        return !!resource.unitId && grant.scopeId === resource.unitId;
      case 'unit_tree':
        return !!resourceUnitPath && !!grant.unitPath && resourceUnitPath.startsWith(grant.unitPath);
      case 'case':
        return !!resource.caseId && grant.scopeId === resource.caseId;
    }
  }

  /** True when the permission is held in any scope (menu building, list endpoints). */
  async hasAnywhere(code: PermissionCode): Promise<boolean> {
    return (await this.grants()).some((g) => g.permission === code);
  }

  async has(code: PermissionCode, resource: ResourceScope = {}): Promise<boolean> {
    const grants = (await this.grants()).filter((g) => g.permission === code);
    if (grants.length === 0) return false;
    if (grants.some((g) => g.scopeType === 'tenant')) return true;
    const path = resource.unitId && grants.some((g) => g.scopeType === 'unit_tree') ? await this.unitPath(resource.unitId) : null;
    return grants.some((g) => AclService.covers(g, resource, path));
  }

  /** Throws FORBIDDEN (and audits the denial) unless the permission covers the resource. */
  async assert(code: PermissionCode, resource: ResourceScope = {}, target?: { type: string; id: string }): Promise<void> {
    if (await this.has(code, resource)) return;
    await this.audit.recordDetached({
      action: 'acl.denied',
      result: 'denied',
      targetType: target?.type,
      targetId: target?.id,
      after: { permission: code, resource },
    });
    throw new AppError('FORBIDDEN', { permission: code });
  }

  /** Units (or cases) in which the permission applies — for scoping list queries. */
  async filterFor(code: PermissionCode): Promise<UnitFilter> {
    const grants = (await this.grants()).filter((g) => g.permission === code);
    if (grants.some((g) => g.scopeType === 'tenant')) return { all: true };
    return {
      all: false,
      unitIds: grants.filter((g) => g.scopeType === 'unit').map((g) => g.scopeId!),
      treePaths: grants.filter((g) => g.scopeType === 'unit_tree' && g.unitPath).map((g) => g.unitPath!),
      caseIds: grants.filter((g) => g.scopeType === 'case').map((g) => g.scopeId!),
    };
  }

  /** SQL predicate restricting `unitColumn` to the filter (use with a join on org_units.path). */
  static unitPredicate(filter: UnitFilter, unitIdCol: unknown, unitPathCol: unknown) {
    if (filter.all) return sql`true`;
    const parts = [
      ...filter.unitIds.map((id) => sql`${unitIdCol} = ${id}`),
      ...filter.treePaths.map((p) => sql`${unitPathCol} like ${p + '%'}`),
    ];
    return parts.length ? sql`(${sql.join(parts, sql` or `)})` : sql`false`;
  }

  /** Effective permissions grouped by code (for clients to build menus, section 16). */
  async summary() {
    const grants = await this.grants();
    const out: Record<string, { scopeType: ScopeType; scopeId: string | null }[]> = {};
    for (const g of grants) (out[g.permission] ??= []).push({ scopeType: g.scopeType, scopeId: g.scopeId });
    return out;
  }
}
