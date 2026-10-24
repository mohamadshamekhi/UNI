import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { normalizeFa, normalizeMobile } from '../../common/util/normalize.js';
import { DbService } from '../../database/db.service.js';
import { fileObjects, memberships, orgUnitTypes, tenants, users, type TenantSettings, type TenantStatus } from '../../database/schema.js';
import { FilesService } from '../files/files.service.js';
import { RolesService } from '../acl/roles.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantResolverMiddleware } from './tenant-resolver.middleware.js';

/** Modules a platform admin can enable per tenant (TEN-05). */
export const AVAILABLE_MODULES = ['thesis', 'paper', 'news', 'events', 'payment', 'reporting'] as const;

export const DEFAULT_SETTINGS: TenantSettings = {
  calendar: 'jalali',
  locale: 'fa',
  timezone: 'Asia/Tehran',
  passwordPolicy: { minLength: 8 },
  storageQuotaBytes: 20 * 1024 ** 3,
  membership: { reapplyAfterDays: 0, revisionDeadlineDays: 7 },
};

const TRANSITIONS: Record<TenantStatus, TenantStatus[]> = {
  draft: ['active', 'archived'],
  active: ['suspended', 'archived'],
  suspended: ['active', 'archived'],
  archived: [],
};

export interface CreateTenantInput {
  slug: string;
  nameFa: string;
  nameEn?: string;
  domain?: string;
  settings?: TenantSettings;
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly db: DbService,
    private readonly roles: RolesService,
    private readonly audit: AuditService,
    private readonly resolver: TenantResolverMiddleware,
    private readonly files: FilesService,
  ) {}

  /** Creating a tenant is configuration only (TEN-06): row + role copies + default unit types. */
  async create(input: CreateTenantInput) {
    const [tenant] = await this.db.run((tx) =>
      tx
        .insert(tenants)
        .values({
          slug: input.slug,
          nameFa: normalizeFa(input.nameFa),
          nameEn: input.nameEn,
          domain: input.domain?.toLowerCase(),
          settings: { ...DEFAULT_SETTINGS, ...input.settings },
        })
        .onConflictDoNothing()
        .returning(),
    );
    if (!tenant) throw new AppError('CONFLICT', { field: 'slug|domain' });

    await this.db.withTenant(tenant.id, async (tx) => {
      await this.roles.copyTemplatesToTenant(tx, tenant.id);
      await tx.insert(orgUnitTypes).values([
        { tenantId: tenant.id, key: 'faculty', nameFa: 'دانشکده', nameEn: 'Faculty', isFacultyLevel: true },
        { tenantId: tenant.id, key: 'department', nameFa: 'گروه', nameEn: 'Department' },
        { tenantId: tenant.id, key: 'field', nameFa: 'رشته', nameEn: 'Field of study' },
      ]);
    });
    this.resolver.invalidate();
    await this.audit.record({ action: 'tenant.created', tenantId: null, targetType: 'tenant', targetId: tenant.id, after: tenant });
    return tenant;
  }

  async list(q?: string) {
    const where = q ? or(ilike(tenants.nameFa, `%${normalizeFa(q)}%`), ilike(tenants.slug, `%${q}%`)) : undefined;
    return this.db.run((tx) => tx.select().from(tenants).where(where).orderBy(asc(tenants.createdAt)));
  }

  async get(id: string) {
    const [t] = await this.db.run((tx) => tx.select().from(tenants).where(eq(tenants.id, id)));
    if (!t) throw new AppError('NOT_FOUND');
    return t;
  }

  async update(id: string, patch: { nameFa?: string; nameEn?: string; domain?: string | null; settings?: TenantSettings }) {
    const before = await this.get(id);
    const logoId = patch.settings?.branding?.logoFileId;
    if (logoId && logoId !== before.settings.branding?.logoFileId) await this.assertLogo(id, logoId);
    const [after] = await this.db.run((tx) =>
      tx
        .update(tenants)
        .set({
          nameFa: patch.nameFa ? normalizeFa(patch.nameFa) : before.nameFa,
          nameEn: patch.nameEn ?? before.nameEn,
          domain: patch.domain === undefined ? before.domain : patch.domain?.toLowerCase() ?? null,
          settings: patch.settings ? { ...before.settings, ...patch.settings } : before.settings,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, id))
        .returning(),
    );
    await this.audit.record({ action: 'tenant.updated', tenantId: id, targetType: 'tenant', targetId: id, before, after });
    this.resolver.invalidate();
    return after!;
  }

  /** UX-10: the logo must be a scanned branding_logo upload of this tenant. */
  private async assertLogo(tenantId: string, fileId: string) {
    const [f] = await this.db.withTenant(tenantId, (tx) =>
      tx
        .update(fileObjects)
        .set({ linkedType: 'tenant_logo', linkedId: tenantId })
        .where(and(eq(fileObjects.id, fileId), eq(fileObjects.purpose, 'branding_logo'), sql`${fileObjects.scanStatus} in ('clean', 'skipped')`))
        .returning({ id: fileObjects.id }),
    );
    if (!f) throw new AppError('VALIDATION_FAILED', { field: 'branding.logoFileId' });
  }

  /** Logo of an active tenant for public pages (null when none is set). */
  async publicLogo(slug: string) {
    const [t] = await this.db.sys.select({ id: tenants.id, settings: tenants.settings, status: tenants.status }).from(tenants).where(eq(tenants.slug, slug));
    const fileId = t?.settings.branding?.logoFileId;
    if (!t || t.status !== 'active' || !fileId) return null;
    return this.files.openPublic(t.id, fileId, 'branding_logo');
  }

  /** Lifecycle (TEN-04, TEN-10): archive is the only deletion in v1. */
  async setStatus(id: string, status: TenantStatus, reason: string) {
    const before = await this.get(id);
    if (!TRANSITIONS[before.status].includes(status)) {
      throw new AppError('INVALID_STATE_TRANSITION', { from: before.status, to: status });
    }
    const [after] = await this.db.run((tx) =>
      tx.update(tenants).set({ status, updatedAt: new Date() }).where(eq(tenants.id, id)).returning(),
    );
    await this.audit.record({ action: 'tenant.status.changed', tenantId: id, targetType: 'tenant', targetId: id, before: { status: before.status }, after: { status }, reason });
    this.resolver.invalidate();
    return after!;
  }

  async setModules(id: string, modules: string[]) {
    const invalid = modules.filter((m) => !(AVAILABLE_MODULES as readonly string[]).includes(m));
    if (invalid.length) throw new AppError('VALIDATION_FAILED', { invalid });
    const before = await this.get(id);
    const [after] = await this.db.run((tx) =>
      tx.update(tenants).set({ enabledModules: [...new Set(modules)], updatedAt: new Date() }).where(eq(tenants.id, id)).returning(),
    );
    await this.audit.record({ action: 'tenant.modules.changed', tenantId: id, targetType: 'tenant', targetId: id, before: before.enabledModules, after: after!.enabledModules });
    return after!;
  }

  /**
   * Introduces the first university admin (section 4: «مدیر معرفی‌شده»). Reuses an existing
   * account by mobile (AUTH-04); new accounts set their password through the reset flow.
   */
  async addAdmin(tenantId: string, input: { mobile: string; fullName: string }) {
    const mobile = normalizeMobile(input.mobile);
    if (!mobile) throw new AppError('VALIDATION_FAILED', { field: 'mobile' });
    await this.get(tenantId);
    return this.db.withTenant(tenantId, async (tx) => {
      let [user] = await tx.select().from(users).where(eq(users.mobile, mobile));
      user ??= (await tx.insert(users).values({ mobile, fullName: normalizeFa(input.fullName) }).returning())[0]!;

      let [m] = await tx.select().from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, user.id)));
      if (!m) {
        m = (
          await tx
            .insert(memberships)
            .values({ tenantId, userId: user.id, kind: 'staff', status: 'active', decidedAt: new Date(), decidedBy: requestContext.get().userId, validFrom: new Date() })
            .returning()
        )[0]!;
      } else if (m.status !== 'active') {
        await tx.update(memberships).set({ status: 'active', updatedAt: new Date() }).where(eq(memberships.id, m.id));
      }
      const roleId = await this.roles.tenantRoleId(tx, tenantId, 'university_admin');
      const assignment = await this.roles.assign({ tenantId, membershipId: m.id, roleId: roleId!, scopeType: 'tenant' }, tx);
      await this.audit.record({ action: 'tenant.admin.added', tenantId, targetType: 'membership', targetId: m.id, after: { userId: user.id } });
      return { userId: user.id, membershipId: m.id, assignmentId: assignment.id };
    });
  }

  // ------------------------------------------------------------------ tenant-side
  async current() {
    return this.get(requestContext.get().tenant!.id);
  }

  async publicList() {
    return this.db.sys
      .select({ slug: tenants.slug, nameFa: tenants.nameFa, nameEn: tenants.nameEn, branding: sql`${tenants.settings}->'branding'` })
      .from(tenants)
      .where(eq(tenants.status, 'active'))
      .orderBy(asc(tenants.nameFa));
  }
}
