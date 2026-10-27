import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { and, count, countDistinct, eq, inArray, isNull, sql } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { DbService, type Executor } from '../../database/db.service.js';
import {
  memberships,
  orgUnits,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
  type ScopeType,
} from '../../database/schema.js';
import { AuditService } from '../audit/audit.service.js';
import { isPermissionCode, PERMISSIONS, ROLE_TEMPLATES, TENANT_PERMISSIONS, type PermissionCode } from './permissions.catalog.js';

export interface RoleInput {
  key: string;
  nameFa: string;
  nameEn?: string;
  description?: string;
  permissions: string[];
}

export interface AssignmentInput {
  /** Defaults to the request tenant; platform operations pass it explicitly. */
  tenantId?: string;
  membershipId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId?: string | null;
  validFrom?: Date;
  validTo?: Date | null;
}

@Injectable()
export class RolesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Syncs the code catalog and system templates into the database (idempotent). */
  async onApplicationBootstrap() {
    await this.db.sys.transaction(async (tx) => {
      for (const [code, p] of Object.entries(PERMISSIONS)) {
        const platformOnly = 'platformOnly' in p && p.platformOnly === true;
        await tx
          .insert(permissions)
          .values({ code, module: p.module, description: p.description, platformOnly })
          .onConflictDoUpdate({ target: permissions.code, set: { module: p.module, description: p.description, platformOnly } });
      }
      for (const t of ROLE_TEMPLATES) {
        const [existing] = await tx.select({ id: roles.id }).from(roles).where(and(isNull(roles.tenantId), eq(roles.key, t.key)));
        const id =
          existing?.id ??
          (await tx.insert(roles).values({ key: t.key, nameFa: t.nameFa, nameEn: t.nameEn, templateKey: t.key }).returning({ id: roles.id }))[0]!.id;
        await tx.update(roles).set({ nameFa: t.nameFa, nameEn: t.nameEn }).where(eq(roles.id, id));
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
        await tx.insert(rolePermissions).values(t.permissions.map((permissionCode) => ({ roleId: id, permissionCode })));
      }
      // a university admin holds every tenant permission by definition: tenant copies get permissions added in later releases
      await tx.execute(sql`
        insert into role_permissions (role_id, tenant_id, permission_code)
        select r.id, r.tenant_id, p.code from roles r cross join unnest(${`{${TENANT_PERMISSIONS.join(',')}}`}::text[]) as p(code)
        where r.tenant_id is not null and r.template_key = 'university_admin' and r.archived_at is null
        on conflict do nothing`);
    });
    this.logger.log(`ACL catalog synced: ${Object.keys(PERMISSIONS).length} permissions, ${ROLE_TEMPLATES.length} templates`);
  }

  /** Copies every system template into the tenant (ACL-11). Runs inside a tenant-scoped tx. */
  async copyTemplatesToTenant(tx: Executor, tenantId: string) {
    for (const t of ROLE_TEMPLATES) {
      const [role] = await tx
        .insert(roles)
        .values({ tenantId, key: t.key, nameFa: t.nameFa, nameEn: t.nameEn, templateKey: t.key })
        .returning({ id: roles.id });
      await tx.insert(rolePermissions).values(t.permissions.map((permissionCode) => ({ roleId: role!.id, tenantId, permissionCode })));
    }
  }

  private validatePermissions(codes: string[]): PermissionCode[] {
    const unique = [...new Set(codes)];
    const invalid = unique.filter((c) => !isPermissionCode(c) || !TENANT_PERMISSIONS.includes(c));
    if (invalid.length) throw new AppError('ROLE_PERMISSION_INVALID', { invalid });
    return unique as PermissionCode[];
  }

  async list() {
    return this.db.run(async (tx) => {
      const rows = await tx
        .select()
        .from(roles)
        .where(and(eq(roles.tenantId, requestContext.get().tenant!.id), isNull(roles.archivedAt)))
        .orderBy(roles.createdAt);
      const perms = rows.length
        ? await tx.select().from(rolePermissions).where(inArray(rolePermissions.roleId, rows.map((r) => r.id)))
        : [];
      return rows.map((r) => ({ ...r, permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.permissionCode) }));
    });
  }

  async get(roleId: string) {
    return this.db.run(async (tx) => {
      const [role] = await tx.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.tenantId, requestContext.get().tenant!.id)));
      if (!role) throw new AppError('NOT_FOUND');
      const perms = await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, role.id));
      return { ...role, permissions: perms.map((p) => p.permissionCode) };
    });
  }

  /** Custom role composed only from base permissions (ACL-02). */
  async create(input: RoleInput) {
    const tenantId = requestContext.get().tenant!.id;
    const codes = this.validatePermissions(input.permissions);
    return this.db.run(async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({ tenantId, key: input.key, nameFa: input.nameFa, nameEn: input.nameEn, description: input.description })
        .onConflictDoNothing()
        .returning();
      if (!role) throw new AppError('CONFLICT', { field: 'key' });
      if (codes.length) await tx.insert(rolePermissions).values(codes.map((permissionCode) => ({ roleId: role.id, tenantId, permissionCode })));
      await this.audit.record({ action: 'role.created', targetType: 'role', targetId: role.id, after: { ...input, permissions: codes } });
      return { ...role, permissions: codes };
    });
  }

  async update(roleId: string, input: Partial<RoleInput>) {
    const before = await this.get(roleId);
    const tenantId = before.tenantId!;
    const codes = input.permissions ? this.validatePermissions(input.permissions) : undefined;
    return this.db.run(async (tx) => {
      await tx
        .update(roles)
        .set({ nameFa: input.nameFa ?? before.nameFa, nameEn: input.nameEn ?? before.nameEn, description: input.description ?? before.description, updatedAt: new Date() })
        .where(eq(roles.id, roleId));
      if (codes) {
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
        if (codes.length) await tx.insert(rolePermissions).values(codes.map((permissionCode) => ({ roleId, tenantId, permissionCode })));
      }
      const after = await this.get(roleId);
      // ACL-09: role/permission changes are always audited with before/after
      await this.audit.record({ action: 'role.permission.changed', targetType: 'role', targetId: roleId, before, after });
      return after;
    });
  }

  async copy(roleId: string, key: string, nameFa: string) {
    const src = await this.get(roleId);
    return this.create({ key, nameFa, nameEn: src.nameEn ?? undefined, description: src.description ?? undefined, permissions: src.permissions });
  }

  async archive(roleId: string, reason: string) {
    const before = await this.get(roleId);
    const impact = await this.impact(roleId);
    await this.db.run((tx) => tx.update(roles).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(roles.id, roleId)));
    await this.audit.record({ action: 'role.archived', targetType: 'role', targetId: roleId, before, reason, after: impact });
  }

  /** Who is affected by a change to this role (ACL-12). */
  async impact(roleId: string) {
    await this.get(roleId);
    const [row] = await this.db.run((tx) =>
      tx
        .select({ assignments: count(), members: countDistinct(roleAssignments.membershipId) })
        .from(roleAssignments)
        .where(and(eq(roleAssignments.roleId, roleId), isNull(roleAssignments.revokedAt))),
    );
    return { activeAssignments: row?.assignments ?? 0, affectedMembers: row?.members ?? 0 };
  }

  // ------------------------------------------------------------------ assignments

  async listAssignments(membershipId: string) {
    return this.db.run((tx) =>
      tx
        .select({
          id: roleAssignments.id,
          roleId: roleAssignments.roleId,
          roleKey: roles.key,
          roleNameFa: roles.nameFa,
          scopeType: roleAssignments.scopeType,
          scopeId: roleAssignments.scopeId,
          validFrom: roleAssignments.validFrom,
          validTo: roleAssignments.validTo,
          revokedAt: roleAssignments.revokedAt,
        })
        .from(roleAssignments)
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .where(eq(roleAssignments.membershipId, membershipId))
        .orderBy(roleAssignments.createdAt),
    );
  }

  /** Validates that the scope target exists inside this tenant. */
  private async assertScope(tx: Executor, scopeType: ScopeType, scopeId: string | null | undefined) {
    if (scopeType === 'tenant') {
      if (scopeId) throw new AppError('SCOPE_INVALID');
      return;
    }
    if (!scopeId) throw new AppError('SCOPE_INVALID');
    if (scopeType === 'unit' || scopeType === 'unit_tree') {
      const [u] = await tx.select({ id: orgUnits.id }).from(orgUnits).where(and(eq(orgUnits.id, scopeId), eq(orgUnits.status, 'active')));
      if (!u) throw new AppError('SCOPE_INVALID');
    }
    // 'case' scopes are validated by the owning module when it grants them (phase 2+)
  }

  async assign(input: AssignmentInput, executor?: Executor) {
    const ctx = requestContext.get();
    const tenantId = input.tenantId ?? ctx.tenant!.id;
    const run = <T>(fn: (tx: Executor) => Promise<T>) => (executor ? fn(executor) : this.db.run(fn));
    return run(async (tx) => {
      const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.id, input.membershipId), eq(memberships.tenantId, tenantId)));
      if (!m) throw new AppError('NOT_FOUND', { field: 'membershipId' });
      const [role] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.id, input.roleId), eq(roles.tenantId, tenantId), isNull(roles.archivedAt)));
      if (!role) throw new AppError('NOT_FOUND', { field: 'roleId' });
      await this.assertScope(tx, input.scopeType, input.scopeId);
      if (input.validTo && input.validTo <= (input.validFrom ?? new Date())) throw new AppError('VALIDATION_FAILED', { field: 'validTo' });

      const [a] = await tx
        .insert(roleAssignments)
        .values({
          tenantId,
          membershipId: input.membershipId,
          roleId: input.roleId,
          scopeType: input.scopeType,
          scopeId: input.scopeType === 'tenant' ? null : input.scopeId,
          validFrom: input.validFrom ?? new Date(),
          validTo: input.validTo ?? null,
          grantedBy: ctx.userId ?? null,
        })
        .returning();
      await this.audit.record({ action: 'role.assigned', tenantId, targetType: 'membership', targetId: input.membershipId, after: a });
      return a!;
    });
  }

  async revokeAssignment(assignmentId: string, reason: string) {
    const ctx = requestContext.get();
    return this.db.run(async (tx) => {
      const [a] = await tx
        .update(roleAssignments)
        .set({ revokedAt: new Date(), revokedBy: ctx.userId ?? null, revokeReason: reason })
        .where(and(eq(roleAssignments.id, assignmentId), isNull(roleAssignments.revokedAt)))
        .returning();
      if (!a) throw new AppError('NOT_FOUND');
      await this.audit.record({ action: 'role.revoked', targetType: 'membership', targetId: a.membershipId, after: a, reason });
      return a;
    });
  }

  /** Role id of a tenant's copy of a system template. */
  async tenantRoleId(tx: Executor, tenantId: string, templateKey: string): Promise<string | undefined> {
    const [r] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.templateKey, templateKey), isNull(roles.archivedAt)))
      .orderBy(sql`${roles.key} = ${templateKey} desc`)
      .limit(1);
    return r?.id;
  }
}
