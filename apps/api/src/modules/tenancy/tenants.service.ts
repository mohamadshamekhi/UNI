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
    const rows = await this.db.run((tx) => tx.select().from(tenants).where(where).orderBy(asc(tenants.createdAt)));
    // headline counts for the platform list (aggregates only)
    const counts = (
      await this.db.sys.execute<{ tenant_id: string; active: number; pending: number; open_cases: number }>(sql`
        select t.id as tenant_id,
               (select count(*)::int from memberships m where m.tenant_id = t.id and m.status = 'active') as active,
               (select count(*)::int from memberships m where m.tenant_id = t.id and m.status = 'pending_review') as pending,
               (select count(*)::int from cases c where c.tenant_id = t.id and c.status_category in ('open', 'revising')) as open_cases
        from tenants t`)
    ).rows;
    const byId = new Map(counts.map((c) => [c.tenant_id, c]));
    return rows.map((r) => ({ ...r, stats: { activeMembers: byId.get(r.id)?.active ?? 0, pendingMembers: byId.get(r.id)?.pending ?? 0, openCases: byId.get(r.id)?.open_cases ?? 0 } }));
  }

  async get(id: string) {
    const [t] = await this.db.run((tx) => tx.select().from(tenants).where(eq(tenants.id, id)));
    if (!t) throw new AppError('NOT_FOUND');
    return t;
  }

  /**
   * Platform view of one university (TEN, section 5 «مدیر کل»): aggregate numbers only — people,
   * processes, content, money and storage — plus who administers it. No case, paper or personal
   * record contents; those stay with the university's own staff.
   */
  async overview(id: string) {
    const t = await this.get(id);
    const db = this.db.sys;
    const count = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute<T>(q)).rows;
    const [members, cases, theses, papers, events, news, payments, files, activity, units] = await Promise.all([
      count<{ kind: string; status: string; n: number }>(sql`select kind, status, count(*)::int as n from memberships where tenant_id = ${id} group by 1, 2`),
      count<{ status: string; n: number }>(sql`select status_category as status, count(*)::int as n from cases where tenant_id = ${id} group by 1`),
      count<{ status: string; n: number }>(sql`select status, count(*)::int as n from theses where tenant_id = ${id} group by 1`),
      count<{ status: string; n: number }>(sql`select status, count(*)::int as n from papers where tenant_id = ${id} and status <> 'draft' group by 1`),
      count<{ total: number; upcoming: number; registrations: number }>(sql`
        select count(*)::int as total, count(*) filter (where ends_at >= now() and status <> 'cancelled')::int as upcoming,
               (select count(*)::int from event_registrations r where r.tenant_id = ${id} and r.status <> 'cancelled') as registrations
        from events where tenant_id = ${id} and status <> 'draft'`),
      count<{ published: number; channels: number }>(sql`
        select count(*) filter (where status = 'published')::int as published, (select count(*)::int from news_channels c where c.tenant_id = ${id}) as channels
        from news_posts where tenant_id = ${id}`),
      count<{ paid: string; paid_count: number; review: number; open: number }>(sql`
        select coalesce(sum(amount) filter (where status = 'succeeded'), 0)::text as paid, count(*) filter (where status = 'succeeded')::int as paid_count,
               count(*) filter (where status = 'review')::int as review, count(*) filter (where status in ('created', 'pending', 'failed'))::int as open
        from payment_requests where tenant_id = ${id}`),
      count<{ n: number; bytes: string }>(sql`select count(*)::int as n, coalesce(sum(size_bytes), 0)::text as bytes from file_objects where tenant_id = ${id} and deleted_at is null`),
      count<{ last_at: Date | null; actions_30d: number; sms_30d: number; logins_30d: number }>(sql`
        select (select to_json(max(occurred_at)) #>> '{}' from audit_logs where tenant_id = ${id}) as last_at,
               (select count(*)::int from audit_logs where tenant_id = ${id} and occurred_at > now() - interval '30 days') as actions_30d,
               (select count(*)::int from notification_deliveries where tenant_id = ${id} and channel = 'sms' and created_at > now() - interval '30 days') as sms_30d,
               (select count(distinct m.user_id)::int from sessions s join memberships m on m.user_id = s.user_id and m.tenant_id = ${id} and m.status = 'active'
                 where s.last_used_at > now() - interval '30 days') as logins_30d`),
      count<{ units: number; roles: number }>(sql`
        select (select count(*)::int from org_units where tenant_id = ${id} and status = 'active') as units,
               (select count(*)::int from roles where tenant_id = ${id} and archived_at is null) as roles`),
    ]);
    const admins = await count<{ full_name: string; mobile: string | null; status: string; since: Date }>(sql`
      select distinct on (m.id) u.full_name, u.mobile, m.status, to_json(ra.created_at) #>> '{}' as since
      from role_assignments ra join roles r on r.id = ra.role_id and r.template_key = 'university_admin'
      join memberships m on m.id = ra.membership_id join users u on u.id = m.user_id
      where ra.tenant_id = ${id} and ra.revoked_at is null
      order by m.id, ra.created_at`);
    const by = (rows: { status: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.status, r.n]));
    const sum = (rows: { n: number }[]) => rows.reduce((a, r) => a + r.n, 0);
    await this.audit.record({ action: 'tenant.overview.viewed', tenantId: id, targetType: 'tenant', targetId: id });
    return {
      tenant: { id: t.id, slug: t.slug, nameFa: t.nameFa, status: t.status, enabledModules: t.enabledModules },
      members: {
        total: sum(members),
        byStatus: members.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + r.n }), {}),
        activeByKind: Object.fromEntries(members.filter((r) => r.status === 'active').map((r) => [r.kind, r.n])),
      },
      admins: admins.map((a) => ({ fullName: a.full_name, mobile: a.mobile, status: a.status, since: a.since })),
      structure: units[0]!,
      cases: { total: sum(cases), byStatus: by(cases) },
      theses: { total: sum(theses), byStatus: by(theses) },
      papers: { total: sum(papers), byStatus: by(papers) },
      events: events[0]!,
      news: news[0]!,
      payments: { paid: Number(payments[0]!.paid), paidCount: payments[0]!.paid_count, review: payments[0]!.review, open: payments[0]!.open },
      storage: { files: files[0]!.n, bytes: Number(files[0]!.bytes), quota: t.settings.storageQuotaBytes ?? null },
      activity: { lastAt: activity[0]!.last_at, actions30d: activity[0]!.actions_30d, sms30d: activity[0]!.sms_30d, activeUsers30d: activity[0]!.logins_30d },
    };
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
