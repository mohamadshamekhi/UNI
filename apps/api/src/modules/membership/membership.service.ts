import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env.js';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { hmac } from '../../common/util/crypto.js';
import { isValidNationalId, normalizeEmail, normalizeFa, normalizeMobile, toAsciiDigits } from '../../common/util/normalize.js';
import { DbService, type Executor } from '../../database/db.service.js';
import {
  membershipEvents,
  membershipUnits,
  memberships,
  orgUnits,
  tenants,
  users,
  type MembershipKind,
  type MembershipStatus,
} from '../../database/schema.js';
import { AclService } from '../acl/acl.service.js';
import { BASE_ROLE_BY_KIND } from '../acl/permissions.catalog.js';
import { RolesService } from '../acl/roles.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FilesService, type FileRow } from '../files/files.service.js';
import { assertPasswordPolicy, hashPassword } from '../identity/password.js';
import { TokensService } from '../identity/tokens.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { readImportFile, type ImportRow } from './import.js';

export type Membership = typeof memberships.$inferSelect;

export interface ApplicationInput {
  kind: Extract<MembershipKind, 'student' | 'faculty' | 'staff'>;
  unitId: string;
  extraUnitIds?: string[];
  memberNo: string;
  profile?: Record<string, unknown>;
  documentFileIds: string[];
}

export interface RegistrationInput extends ApplicationInput {
  mobileProof: string;
  fullName: string;
  email?: string;
  nationalId?: string;
  password: string;
  acceptTerms: boolean;
}

/** Fields a reviewer may ask the applicant to correct (section 6, «نیازمند اصلاح»). */
export const REVISABLE_FIELDS = ['fullName', 'memberNo', 'unitId', 'profile', 'documents'] as const;
export type RevisableField = (typeof REVISABLE_FIELDS)[number];

const LINK_TYPE = 'membership';

/** Allowed status transitions; anything else is INVALID_STATE_TRANSITION. */
const TRANSITIONS: Record<MembershipStatus, MembershipStatus[]> = {
  draft: ['pending_review'],
  pending_review: ['active', 'rejected', 'needs_revision', 'pending_review'],
  needs_revision: ['pending_review', 'rejected'],
  active: ['suspended', 'ended'],
  suspended: ['active', 'ended'],
  rejected: ['pending_review'],
  ended: [],
};

@Injectable()
export class MembershipService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly acl: AclService,
    private readonly roles: RolesService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly tokens: TokensService,
    private readonly outbox: OutboxService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    // documents of a membership: applicant (owner) or a reviewer with confidential access in scope
    this.files.registerAccessResolver(LINK_TYPE, async (file: FileRow) => {
      const m = await this.find(file.linkedId!);
      if (!m) return false;
      const scope = { unitId: m.reviewUnitId };
      return (await this.acl.has('membership.view', scope)) && (await this.acl.has('file.view.confidential', scope));
    });
  }

  private tenantId() {
    return requestContext.get().tenant!.id;
  }

  private async tenantSettings() {
    const [t] = await this.db.sys.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, this.tenantId()));
    return t?.settings ?? {};
  }

  private nationalIdHash(nationalId: string) {
    return hmac(this.env.HASH_PEPPER, `nid:${toAsciiDigits(nationalId)}`);
  }

  async find(id: string, tx?: Executor) {
    const q = (t: Executor) => t.select().from(memberships).where(eq(memberships.id, id)).limit(1);
    const [m] = tx ? await q(tx) : await this.db.run(q);
    return m;
  }

  private async mustFind(id: string, tx?: Executor) {
    const m = await this.find(id, tx);
    if (!m) throw new AppError('NOT_FOUND');
    return m;
  }

  private assertTransition(from: MembershipStatus, to: MembershipStatus) {
    if (!TRANSITIONS[from].includes(to)) throw new AppError('INVALID_STATE_TRANSITION', { from, to });
  }

  private async event(
    tx: Executor,
    m: Pick<Membership, 'id' | 'tenantId'>,
    type: string,
    e: { from?: string; to?: string; publicNote?: string | null; internalNote?: string | null; data?: Record<string, unknown> } = {},
  ) {
    await tx.insert(membershipEvents).values({
      tenantId: m.tenantId,
      membershipId: m.id,
      actorUserId: requestContext.find()?.userId ?? null,
      type,
      fromStatus: e.from ?? null,
      toStatus: e.to ?? null,
      publicNote: e.publicNote ?? null,
      internalNote: e.internalNote ?? null,
      data: e.data ?? {},
    });
  }

  /** TEN-12/13: selected unit must be active in this tenant; primary + optional extra units. */
  private async assertUnits(tx: Executor, unitIds: string[]) {
    const unique = [...new Set(unitIds)];
    const rows = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(inArray(orgUnits.id, unique), eq(orgUnits.status, 'active')));
    if (rows.length !== unique.length) throw new AppError('UNIT_INVALID');
  }

  private normalizeProfile(profile: Record<string, unknown> | undefined) {
    const out: Record<string, unknown> = {};
    for (const key of ['degree', 'field', 'entryYear', 'academicRank', 'orcid'] as const) {
      const v = profile?.[key];
      if (v === undefined || v === null || v === '') continue;
      out[key] = typeof v === 'string' ? normalizeFa(v) : v;
    }
    return out;
  }

  private async writeApplication(tx: Executor, userId: string, input: ApplicationInput, existing?: Membership) {
    const tenantId = this.tenantId();
    await this.assertUnits(tx, [input.unitId, ...(input.extraUnitIds ?? [])]);
    const memberNo = normalizeFa(input.memberNo);
    const [taken] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.memberNo, memberNo), sql`${memberships.userId} <> ${userId}`))
      .limit(1);
    if (taken) throw new AppError('MEMBER_NO_TAKEN');

    const values = {
      kind: input.kind,
      status: 'pending_review' as const,
      memberNo,
      profile: this.normalizeProfile(input.profile),
      reviewUnitId: input.unitId,
      submittedAt: new Date(),
      decisionReason: null,
      revisionRequest: null,
      revisionDeadline: null,
      updatedAt: new Date(),
    };
    let m: Membership;
    if (existing) {
      this.assertTransition(existing.status, 'pending_review');
      [m] = (await tx.update(memberships).set(values).where(eq(memberships.id, existing.id)).returning()) as [Membership];
      await tx.delete(membershipUnits).where(eq(membershipUnits.membershipId, m.id));
    } else {
      [m] = (await tx.insert(memberships).values({ tenantId, userId, ...values }).returning()) as [Membership];
    }
    await tx.insert(membershipUnits).values([
      { tenantId, membershipId: m.id, unitId: input.unitId, isPrimary: true },
      ...[...new Set(input.extraUnitIds ?? [])]
        .filter((u) => u !== input.unitId)
        .map((unitId) => ({ tenantId, membershipId: m.id, unitId, isPrimary: false })),
    ]);
    await this.event(tx, m, 'submitted', { from: existing?.status, to: 'pending_review' });
    await this.outbox.emit('membership.submitted', { membershipId: m.id, userId, unitId: input.unitId }, `membership.submitted:${m.id}:${m.submittedAt!.getTime()}`);
    return m;
  }

  /**
   * Public registration (section 6 steps 1–7). Mobile ownership comes from an OTP proof; the
   * membership itself still needs a reviewer's approval (OTP ≠ membership).
   */
  async register(input: RegistrationInput) {
    if (!input.acceptTerms) throw new AppError('VALIDATION_FAILED', { field: 'acceptTerms' });
    const proof = this.tokens.verifyProof(input.mobileProof, ['register']);
    const mobile = proof.sub;
    const email = input.email ? normalizeEmail(input.email) : null;
    if (input.nationalId && !isValidNationalId(input.nationalId)) throw new AppError('VALIDATION_FAILED', { field: 'nationalId' });
    const nidHash = input.nationalId ? this.nationalIdHash(input.nationalId) : null;
    const settings = await this.tenantSettings();
    assertPasswordPolicy(input.password, settings.passwordPolicy?.minLength);

    // AUTH-04: never create a duplicate account — existing people log in and apply instead
    const dup: SQL[] = [eq(users.mobile, mobile)];
    if (email) dup.push(eq(users.email, email));
    if (nidHash) dup.push(eq(users.nationalIdHash, nidHash));
    const [existing] = await this.db.sys.select({ id: users.id }).from(users).where(or(...dup)).limit(1);
    if (existing) throw new AppError('ACCOUNT_EXISTS');
    if (!(await this.tokens.consumeProof(proof))) throw new AppError('PROOF_INVALID');

    const passwordHash = await hashPassword(input.password);
    return this.db.run(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ mobile, email, fullName: normalizeFa(input.fullName), nationalIdHash: nidHash, passwordHash, mobileVerifiedAt: new Date() })
        .returning({ id: users.id });
      const m = await this.writeApplication(tx, user!.id, input);
      await this.files.link(input.documentFileIds, LINK_TYPE, m.id, { userId: user!.id, uploadSubject: this.files.uploadSubject(mobile) });
      await this.audit.record({ action: 'membership.registered', actorUserId: user!.id, targetType: 'membership', targetId: m.id, after: { kind: m.kind, unitId: m.reviewUnitId } });
      return { userId: user!.id, membershipId: m.id, status: m.status };
    });
  }

  /** Signed-in person applying to (another) tenant, or re-applying after rejection. */
  async apply(input: ApplicationInput) {
    const ctx = requestContext.get();
    const userId = ctx.userId!;
    return this.db.run(async (tx) => {
      const [existing] = await tx.select().from(memberships).where(and(eq(memberships.tenantId, this.tenantId()), eq(memberships.userId, userId)));
      if (existing && existing.status !== 'rejected') throw new AppError('MEMBERSHIP_EXISTS', { status: existing.status });
      if (existing?.decidedAt) {
        const wait = (await this.tenantSettings()).membership?.reapplyAfterDays ?? 0;
        const allowedAt = new Date(existing.decidedAt.getTime() + wait * 86400_000);
        if (allowedAt > new Date()) throw new AppError('CONFLICT', { reapplyAfter: allowedAt.toISOString() });
      }
      const m = await this.writeApplication(tx, userId, input, existing);
      await this.files.link(input.documentFileIds, LINK_TYPE, m.id, { userId });
      await this.audit.record({ action: 'membership.applied', targetType: 'membership', targetId: m.id, after: { kind: m.kind, unitId: m.reviewUnitId } });
      return { membershipId: m.id, status: m.status };
    });
  }

  // ------------------------------------------------------------------ applicant views

  /** All of the caller's memberships across tenants (RLS policy own_rows_read). */
  async mine() {
    const userId = requestContext.get().userId!;
    return this.db.transaction({ userId }, (tx) =>
      tx
        .select({
          id: memberships.id,
          kind: memberships.kind,
          status: memberships.status,
          tenantSlug: tenants.slug,
          tenantNameFa: tenants.nameFa,
          submittedAt: memberships.submittedAt,
          decidedAt: memberships.decidedAt,
        })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(eq(memberships.userId, userId))
        .orderBy(desc(memberships.createdAt)),
    );
  }

  /** AUTH-15: before approval the applicant sees only status, public notes and requested fixes. */
  async myApplication() {
    const ctx = requestContext.get();
    const m = await this.db.run(async (tx) => {
      const [row] = await tx.select().from(memberships).where(and(eq(memberships.tenantId, this.tenantId()), eq(memberships.userId, ctx.userId!)));
      return row;
    });
    if (!m) throw new AppError('NOT_FOUND');
    const events = await this.db.run((tx) =>
      tx
        .select({ type: membershipEvents.type, toStatus: membershipEvents.toStatus, publicNote: membershipEvents.publicNote, occurredAt: membershipEvents.occurredAt })
        .from(membershipEvents)
        .where(eq(membershipEvents.membershipId, m.id))
        .orderBy(membershipEvents.occurredAt),
    );
    return {
      id: m.id,
      kind: m.kind,
      status: m.status,
      memberNo: m.memberNo,
      profile: m.profile,
      unitId: m.reviewUnitId,
      decisionReason: m.status === 'rejected' ? m.decisionReason : null,
      revisionRequest: m.status === 'needs_revision' ? m.revisionRequest : null,
      revisionDeadline: m.status === 'needs_revision' ? m.revisionDeadline : null,
      documents: await this.files.listLinked(LINK_TYPE, m.id),
      history: events,
    };
  }

  /** Applicant fixes only the requested fields within the deadline, then resubmits. */
  async resubmit(patch: { fullName?: string; memberNo?: string; unitId?: string; profile?: Record<string, unknown>; documentFileIds?: string[] }) {
    const ctx = requestContext.get();
    return this.db.run(async (tx) => {
      const [m] = await tx.select().from(memberships).where(and(eq(memberships.tenantId, this.tenantId()), eq(memberships.userId, ctx.userId!)));
      if (!m) throw new AppError('NOT_FOUND');
      if (m.status !== 'needs_revision') throw new AppError('INVALID_STATE_TRANSITION', { from: m.status, to: 'pending_review' });
      if (m.revisionDeadline && m.revisionDeadline < new Date()) throw new AppError('REVISION_DEADLINE_PASSED');
      const allowed = new Set(m.revisionRequest?.fields ?? []);
      const provided: RevisableField[] = [];
      if (patch.fullName !== undefined) provided.push('fullName');
      if (patch.memberNo !== undefined) provided.push('memberNo');
      if (patch.unitId !== undefined) provided.push('unitId');
      if (patch.profile !== undefined) provided.push('profile');
      if (patch.documentFileIds !== undefined) provided.push('documents');
      const notAllowed = provided.filter((f) => !allowed.has(f));
      if (notAllowed.length) throw new AppError('VALIDATION_FAILED', { notEditable: notAllowed });

      const before = { memberNo: m.memberNo, profile: m.profile, unitId: m.reviewUnitId };
      if (patch.fullName) await tx.update(users).set({ fullName: normalizeFa(patch.fullName), updatedAt: new Date() }).where(eq(users.id, m.userId));
      if (patch.unitId) {
        await this.assertUnits(tx, [patch.unitId]);
        await tx.delete(membershipUnits).where(and(eq(membershipUnits.membershipId, m.id), eq(membershipUnits.isPrimary, true)));
        await tx.insert(membershipUnits).values({ tenantId: m.tenantId, membershipId: m.id, unitId: patch.unitId, isPrimary: true }).onConflictDoUpdate({ target: [membershipUnits.membershipId, membershipUnits.unitId], set: { isPrimary: true } });
      }
      if (patch.memberNo) {
        const memberNo = normalizeFa(patch.memberNo);
        const [taken] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.memberNo, memberNo), sql`${memberships.id} <> ${m.id}`));
        if (taken) throw new AppError('MEMBER_NO_TAKEN');
      }
      const [after] = await tx
        .update(memberships)
        .set({
          status: 'pending_review',
          memberNo: patch.memberNo ? normalizeFa(patch.memberNo) : m.memberNo,
          profile: patch.profile ? { ...m.profile, ...this.normalizeProfile(patch.profile) } : m.profile,
          reviewUnitId: patch.unitId ?? m.reviewUnitId,
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(memberships.id, m.id))
        .returning();
      if (patch.documentFileIds?.length) await this.files.link(patch.documentFileIds, LINK_TYPE, m.id, { userId: m.userId });
      await this.event(tx, m, 'resubmitted', { from: m.status, to: 'pending_review', data: { fields: provided } });
      await this.audit.record({ action: 'membership.resubmitted', targetType: 'membership', targetId: m.id, before, after: { memberNo: after!.memberNo, profile: after!.profile, unitId: after!.reviewUnitId } });
      return { membershipId: m.id, status: after!.status };
    });
  }

  // ------------------------------------------------------------------ reviewer side

  /** Review queue scoped to the units where the caller holds membership.view (AUTH-13). */
  async list(q: { status?: MembershipStatus; unitId?: string; kind?: MembershipKind; search?: string; limit: number; offset: number }) {
    const filter = await this.acl.filterFor('membership.view');
    const where: SQL[] = [AclService.unitPredicate(filter, memberships.reviewUnitId, orgUnits.path)];
    if (q.status) where.push(eq(memberships.status, q.status));
    if (q.kind) where.push(eq(memberships.kind, q.kind));
    if (q.unitId) where.push(eq(memberships.reviewUnitId, q.unitId));
    if (q.search) {
      const s = `%${normalizeFa(q.search)}%`;
      where.push(or(ilike(users.fullName, s), ilike(memberships.memberNo, s))!);
    }
    return this.db.run(async (tx) => {
      const rows = await tx
        .select({
          id: memberships.id,
          kind: memberships.kind,
          status: memberships.status,
          memberNo: memberships.memberNo,
          fullName: users.fullName,
          unitId: memberships.reviewUnitId,
          unitNameFa: orgUnits.nameFa,
          submittedAt: memberships.submittedAt,
          revisionDeadline: memberships.revisionDeadline,
          total: sql<number>`count(*) over()::int`,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .leftJoin(orgUnits, eq(orgUnits.id, memberships.reviewUnitId))
        .where(and(...where))
        .orderBy(desc(memberships.submittedAt))
        .limit(q.limit)
        .offset(q.offset);
      return { items: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
    });
  }

  async detail(id: string) {
    const m = await this.mustFind(id);
    await this.acl.assert('membership.view', { unitId: m.reviewUnitId }, { type: 'membership', id });
    const [user] = await this.db.run((tx) =>
      tx.select({ id: users.id, fullName: users.fullName, mobile: users.mobile, email: users.email }).from(users).where(eq(users.id, m.userId)),
    );
    const units = await this.db.run((tx) => tx.select().from(membershipUnits).where(eq(membershipUnits.membershipId, id)));
    const history = await this.db.run((tx) => tx.select().from(membershipEvents).where(eq(membershipEvents.membershipId, id)).orderBy(membershipEvents.occurredAt));
    const canSeeDocs = await this.acl.has('file.view.confidential', { unitId: m.reviewUnitId });
    return {
      ...m,
      user,
      units,
      documents: canSeeDocs ? await this.files.listLinked(LINK_TYPE, id) : [],
      history,
    };
  }

  /** Common guard for reviewer decisions: scope permission + separation of duties. */
  private async loadForDecision(tx: Executor, id: string) {
    const m = await this.mustFind(id, tx);
    await this.acl.assert('membership.approve', { unitId: m.reviewUnitId }, { type: 'membership', id });
    if (m.userId === requestContext.get().userId) throw new AppError('SEPARATION_OF_DUTIES');
    return m;
  }

  async approve(id: string, note?: string) {
    return this.db.run(async (tx) => {
      const m = await this.loadForDecision(tx, id);
      this.assertTransition(m.status, 'active');
      const now = new Date();
      const [after] = await tx
        .update(memberships)
        .set({ status: 'active', decidedAt: now, decidedBy: requestContext.get().userId, validFrom: now, decisionReason: null, revisionRequest: null, revisionDeadline: null, updatedAt: now })
        .where(and(eq(memberships.id, id), eq(memberships.status, m.status)))
        .returning();
      if (!after) throw new AppError('CONFLICT');
      const baseRole = BASE_ROLE_BY_KIND[m.kind];
      if (baseRole) {
        const roleId = await this.roles.tenantRoleId(tx, m.tenantId, baseRole);
        if (roleId) await this.roles.assign({ membershipId: m.id, roleId, scopeType: 'tenant' }, tx);
      }
      await this.event(tx, m, 'approved', { from: m.status, to: 'active', publicNote: note });
      await this.outbox.emit('membership.decided', { membershipId: m.id, userId: m.userId, decision: 'approved' }, `membership.decided:${m.id}:${now.getTime()}`);
      await this.audit.record({ action: 'membership.approved', targetType: 'membership', targetId: m.id, before: { status: m.status }, after: { status: 'active' } });
      return after;
    });
  }

  async reject(id: string, reason: string, internalNote?: string) {
    return this.db.run(async (tx) => {
      const m = await this.loadForDecision(tx, id);
      this.assertTransition(m.status, 'rejected');
      const now = new Date();
      const [after] = await tx
        .update(memberships)
        .set({ status: 'rejected', decidedAt: now, decidedBy: requestContext.get().userId, decisionReason: reason, updatedAt: now })
        .where(and(eq(memberships.id, id), eq(memberships.status, m.status)))
        .returning();
      if (!after) throw new AppError('CONFLICT');
      await this.event(tx, m, 'rejected', { from: m.status, to: 'rejected', publicNote: reason, internalNote });
      await this.outbox.emit('membership.decided', { membershipId: m.id, userId: m.userId, decision: 'rejected' }, `membership.decided:${m.id}:${now.getTime()}`);
      await this.audit.record({ action: 'membership.rejected', targetType: 'membership', targetId: m.id, before: { status: m.status }, after: { status: 'rejected' }, reason });
      return after;
    });
  }

  async requestRevision(id: string, input: { reason: string; fields: RevisableField[]; deadlineDays?: number; internalNote?: string }) {
    const days = input.deadlineDays ?? (await this.tenantSettings()).membership?.revisionDeadlineDays ?? 7;
    return this.db.run(async (tx) => {
      const m = await this.loadForDecision(tx, id);
      this.assertTransition(m.status, 'needs_revision');
      const deadline = new Date(Date.now() + days * 86400_000);
      const [after] = await tx
        .update(memberships)
        .set({ status: 'needs_revision', revisionRequest: { fields: input.fields, reason: input.reason }, revisionDeadline: deadline, updatedAt: new Date() })
        .where(and(eq(memberships.id, id), eq(memberships.status, m.status)))
        .returning();
      if (!after) throw new AppError('CONFLICT');
      await this.event(tx, m, 'revision_requested', { from: m.status, to: 'needs_revision', publicNote: input.reason, internalNote: input.internalNote, data: { fields: input.fields, deadline } });
      await this.outbox.emit('membership.revision_requested', { membershipId: m.id, userId: m.userId }, `membership.revision:${m.id}:${deadline.getTime()}`);
      await this.audit.record({ action: 'membership.revision_requested', targetType: 'membership', targetId: m.id, after: { fields: input.fields, deadline }, reason: input.reason });
      return after;
    });
  }

  /** Move a request to the correct unit without re-registration (AUTH-13). */
  async transfer(id: string, unitId: string, reason: string) {
    return this.db.run(async (tx) => {
      const m = await this.loadForDecision(tx, id);
      if (m.status !== 'pending_review' && m.status !== 'needs_revision') throw new AppError('INVALID_STATE_TRANSITION', { from: m.status });
      await this.assertUnits(tx, [unitId]);
      await tx.update(memberships).set({ reviewUnitId: unitId, updatedAt: new Date() }).where(eq(memberships.id, id));
      await tx.delete(membershipUnits).where(and(eq(membershipUnits.membershipId, id), eq(membershipUnits.isPrimary, true)));
      await tx
        .insert(membershipUnits)
        .values({ tenantId: m.tenantId, membershipId: id, unitId, isPrimary: true })
        .onConflictDoUpdate({ target: [membershipUnits.membershipId, membershipUnits.unitId], set: { isPrimary: true } });
      await this.event(tx, m, 'transferred', { internalNote: reason, data: { fromUnitId: m.reviewUnitId, toUnitId: unitId } });
      await this.audit.record({ action: 'membership.transferred', targetType: 'membership', targetId: id, before: { unitId: m.reviewUnitId }, after: { unitId }, reason });
      return { membershipId: id, unitId };
    });
  }

  /** Suspend / reactivate / end (ACL-10): never deletes the account or history. */
  async setLifecycle(id: string, to: 'suspended' | 'active' | 'ended', reason: string) {
    return this.db.run(async (tx) => {
      const m = await this.mustFind(id, tx);
      await this.acl.assert('membership.manage', { unitId: m.reviewUnitId }, { type: 'membership', id });
      if (m.userId === requestContext.get().userId) throw new AppError('SEPARATION_OF_DUTIES');
      if (m.status === 'active' && to === 'active') throw new AppError('INVALID_STATE_TRANSITION', { from: m.status, to });
      if (to === 'active' && m.status !== 'suspended') throw new AppError('INVALID_STATE_TRANSITION', { from: m.status, to });
      this.assertTransition(m.status, to);
      const [after] = await tx
        .update(memberships)
        .set({ status: to, updatedAt: new Date(), validTo: to === 'ended' ? new Date() : m.validTo })
        .where(and(eq(memberships.id, id), eq(memberships.status, m.status)))
        .returning();
      if (!after) throw new AppError('CONFLICT');
      await this.event(tx, m, to === 'active' ? 'reactivated' : to, { from: m.status, to, internalNote: reason });
      await this.audit.record({ action: `membership.${to === 'active' ? 'reactivated' : to}`, targetType: 'membership', targetId: id, before: { status: m.status }, after: { status: to }, reason });
      return after;
    });
  }

  /**
   * Faculty/staff defined by an authorised expert (section 6, «روش اصلی»): pre-approved
   * membership plus an SMS invitation. AUTH-04 reuses an existing account.
   */
  async invite(input: { kind: 'faculty' | 'staff' | 'student'; fullName: string; mobile: string; email?: string; unitId: string; memberNo?: string }) {
    await this.acl.assert('membership.manage', { unitId: input.unitId });
    const mobile = normalizeMobile(input.mobile);
    if (!mobile) throw new AppError('VALIDATION_FAILED', { field: 'mobile' });
    return this.db.run(async (tx) => {
      await this.assertUnits(tx, [input.unitId]);
      let [user] = await tx.select({ id: users.id }).from(users).where(eq(users.mobile, mobile));
      user ??= (
        await tx
          .insert(users)
          .values({ mobile, fullName: normalizeFa(input.fullName), email: input.email ? normalizeEmail(input.email) : null })
          .returning({ id: users.id })
      )[0]!;
      const [existing] = await tx.select().from(memberships).where(and(eq(memberships.tenantId, this.tenantId()), eq(memberships.userId, user.id)));
      if (existing) throw new AppError('MEMBERSHIP_EXISTS', { status: existing.status });
      const memberNo = input.memberNo ? normalizeFa(input.memberNo) : null;
      if (memberNo) {
        const [taken] = await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.memberNo, memberNo));
        if (taken) throw new AppError('MEMBER_NO_TAKEN');
      }
      const now = new Date();
      const [m] = await tx
        .insert(memberships)
        .values({ tenantId: this.tenantId(), userId: user.id, kind: input.kind, status: 'active', memberNo, reviewUnitId: input.unitId, submittedAt: now, decidedAt: now, decidedBy: requestContext.get().userId, validFrom: now })
        .returning();
      await tx.insert(membershipUnits).values({ tenantId: m!.tenantId, membershipId: m!.id, unitId: input.unitId, isPrimary: true });
      const baseRole = BASE_ROLE_BY_KIND[input.kind];
      if (baseRole) {
        const roleId = await this.roles.tenantRoleId(tx, m!.tenantId, baseRole);
        if (roleId) await this.roles.assign({ membershipId: m!.id, roleId, scopeType: 'tenant' }, tx);
      }
      await this.event(tx, m!, 'invited', { to: 'active' });
      await this.outbox.emit('membership.invited', { membershipId: m!.id, userId: user.id }, `membership.invited:${m!.id}`);
      await this.audit.record({ action: 'membership.invited', targetType: 'membership', targetId: m!.id, after: { kind: input.kind, unitId: input.unitId } });
      return { userId: user.id, membershipId: m!.id };
    });
  }

  // ------------------------------------------------------------------ bulk import (AUTH-16)

  /**
   * Validates every row (dry run) or creates the valid ones. Each row is created in its own
   * savepoint, so a bad row never undoes the others. Units match by code or exact name.
   */
  async importMembers(buffer: Buffer, opts: { dryRun: boolean }) {
    const rows = await readImportFile(buffer);
    const units = await this.db.run((tx) =>
      tx.select({ id: orgUnits.id, code: orgUnits.code, nameFa: orgUnits.nameFa }).from(orgUnits).where(eq(orgUnits.status, 'active')),
    );
    const unitByKey = new Map<string, string>();
    for (const u of units) {
      unitByKey.set(normalizeFa(u.nameFa), u.id);
      if (u.code) unitByKey.set(normalizeFa(u.code).toLowerCase(), u.id);
    }
    const seenMobile = new Set<string>();
    const seenMemberNo = new Set<string>();

    type Result = ImportRow & { unitId?: string; status: 'ready' | 'error' | 'created'; errors: string[] };
    const results: Result[] = [];
    for (const r of rows) {
      const errors: string[] = [];
      const mobile = r.mobile ? normalizeMobile(r.mobile) : null;
      const unitId = r.unit ? (unitByKey.get(normalizeFa(r.unit).toLowerCase()) ?? unitByKey.get(normalizeFa(r.unit))) : undefined;
      if (!r.kind) errors.push('نوع عضویت نامعتبر است (دانشجو، استاد یا کارمند).');
      if (!r.fullName || r.fullName.length < 3) errors.push('نام و نام خانوادگی لازم است.');
      if (!mobile) errors.push('شماره موبایل معتبر نیست.');
      else if (seenMobile.has(mobile)) errors.push('این شماره موبایل در فایل تکراری است.');
      if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) errors.push('ایمیل معتبر نیست.');
      if (!unitId) errors.push('واحد پیدا نشد؛ کد یا نام دقیق واحد را وارد کنید.');
      else if (!(await this.acl.has('membership.manage', { unitId }))) errors.push('اجازه افزودن عضو به این واحد را ندارید.');
      if (r.memberNo) {
        if (seenMemberNo.has(r.memberNo)) errors.push('شماره دانشجویی/پرسنلی در فایل تکراری است.');
        seenMemberNo.add(r.memberNo);
      }
      if (mobile) seenMobile.add(mobile);
      if (mobile && errors.length === 0) {
        const existing = await this.db.run((tx) =>
          tx
            .select({ id: memberships.id })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(users.mobile, mobile), eq(memberships.tenantId, this.tenantId())))
            .limit(1),
        );
        if (existing.length) errors.push('این فرد قبلاً در سازمان عضویت دارد.');
      }
      results.push({ ...r, mobile: mobile ?? r.mobile, unitId, status: errors.length ? 'error' : 'ready', errors });
    }

    if (!opts.dryRun) {
      for (const r of results.filter((x) => x.status === 'ready')) {
        try {
          await this.db.savepoint(() =>
            this.invite({ kind: r.kind!, fullName: r.fullName!, mobile: r.mobile!, email: r.email, unitId: r.unitId!, memberNo: r.memberNo }),
          );
          r.status = 'created';
        } catch (err) {
          r.status = 'error';
          r.errors.push(err instanceof AppError ? err.message : 'خطای ناشناخته');
        }
      }
      await this.audit.record({
        action: 'membership.imported',
        targetType: 'tenant',
        targetId: this.tenantId(),
        after: { total: results.length, created: results.filter((r) => r.status === 'created').length, failed: results.filter((r) => r.status === 'error').length },
      });
    }
    const count = (s: Result['status']) => results.filter((r) => r.status === s).length;
    return { dryRun: opts.dryRun, total: results.length, ready: count('ready'), created: count('created'), failed: count('error'), rows: results };
  }
}
