import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { DbService, type Executor } from '../../database/db.service.js';
import {
  fileObjects,
  memberships,
  membershipUnits,
  paperEvents,
  papers,
  paperTracks,
  paperReviews,
  paperVersions,
  type CoAuthor,
  type PaperStatus,
  type Recommendation,
  type ReviewMode,
} from '../../database/schema.js';
import { AclService } from '../acl/acl.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FilesService } from '../files/files.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { scrubManuscript } from './scrub.js';

export type PaperRow = typeof papers.$inferSelect;
export type ReviewRow = typeof paperReviews.$inferSelect;
type Audience = 'all' | 'author' | 'reviewers' | 'managers';

const DAY = 86_400_000;
const FINAL: PaperStatus[] = ['accepted', 'accepted_conditional', 'rejected', 'withdrawn'];
const ACTIVE_REVIEW = ['invited', 'accepted'] as const;
export type ScreenDecision = 'send_to_review' | 'request_fix' | 'reject' | 'forward';
export type Decision = 'accept' | 'accept_conditional' | 'reject' | 'minor_revision' | 'major_revision';

export interface PaperInput {
  trackId: string;
  title: string;
  abstract?: string;
  keywords?: string[];
  degree: string;
  field?: string;
  coAuthors?: CoAuthor[];
  conflicts?: { membershipIds?: string[]; note?: string };
}

/** Year in the Iranian calendar for tracking codes, e.g. P-1405-000123. */
const persianYear = (d: Date) => new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric' }).formatToParts(d).find((p) => p.type === 'year')!.value;

/**
 * Papers and peer review (section 9). Status moves only through these methods; every change is one
 * transaction with an optimistic lock on `papers.lock_version`.
 */
@Injectable()
export class PapersService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly acl: AclService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit() {
    // manuscripts and review attachments: author (own uploads via ownership), managers, assigned reviewers
    this.files.registerAccessResolver('paper', async (file) => {
      const ctx = requestContext.find();
      if (!ctx?.membershipId) return false;
      if (await this.isManager()) return true;
      return this.db.run(async (tx) => {
        const [p] = await tx.select().from(papers).where(eq(papers.id, file.linkedId!)).limit(1);
        if (!p) return false;
        const reviews = await tx
          .select()
          .from(paperReviews)
          .where(and(eq(paperReviews.paperId, p.id), eq(paperReviews.reviewerMembershipId, ctx.membershipId!), inArray(paperReviews.status, ['accepted', 'submitted'])));
        if (!reviews.length) return false;
        const [track] = await tx.select().from(paperTracks).where(eq(paperTracks.id, p.trackId));
        if (!track?.reviewerDownload) return false;
        const versions = await tx.select().from(paperVersions).where(and(eq(paperVersions.paperId, p.id), inArray(paperVersions.round, reviews.map((r) => r.round))));
        // double-blind reviewers only ever get the scrubbed copy
        return versions.some((v) => (p.reviewMode === 'double_blind' ? v.reviewFileId === file.id : v.originalFileId === file.id || v.reviewFileId === file.id));
      });
    });
  }

  // ── access helpers ─────────────────────────────────────────────────────

  private me() {
    const ctx = requestContext.get();
    if (!ctx.membershipId || !ctx.userId) throw new AppError('MEMBERSHIP_REQUIRED');
    return { membershipId: ctx.membershipId, userId: ctx.userId, tenantId: ctx.tenant!.id };
  }

  async isManager() {
    return (await this.acl.hasAnywhere('paper.screen')) || (await this.acl.hasAnywhere('paper.decide')) || (await this.acl.hasAnywhere('paper.assign_reviewer'));
  }

  private async assertPerm(code: 'paper.screen' | 'paper.decide' | 'paper.assign_reviewer') {
    if (!(await this.acl.hasAnywhere(code))) throw new AppError('FORBIDDEN', { permission: code });
  }

  async load(tx: Executor, paperId: string): Promise<PaperRow> {
    const [p] = await tx.select().from(papers).where(eq(papers.id, paperId)).limit(1);
    if (!p) throw new AppError('NOT_FOUND');
    return p;
  }

  /** Bumps the lock or fails when someone else changed the paper meanwhile. */
  private async lock(tx: Executor, p: PaperRow, expected?: PaperStatus[]) {
    if (expected && !expected.includes(p.status)) throw new AppError('INVALID_STATE_TRANSITION', { status: p.status });
    const r = await tx
      .update(papers)
      .set({ lockVersion: sql`${papers.lockVersion} + 1`, updatedAt: new Date() })
      .where(and(eq(papers.id, p.id), eq(papers.lockVersion, p.lockVersion)))
      .returning({ id: papers.id });
    if (!r.length) throw new AppError('CASE_STALE');
  }

  async event(tx: Executor, p: Pick<PaperRow, 'id' | 'tenantId' | 'round'>, type: string, audience: Audience, extra: { note?: string | null; data?: Record<string, unknown>; guestId?: string } = {}) {
    const ctx = requestContext.find();
    await tx.insert(paperEvents).values({
      tenantId: p.tenantId,
      paperId: p.id,
      actorUserId: extra.guestId ? null : (ctx?.userId ?? null),
      actorGuestId: extra.guestId ?? null,
      type,
      round: p.round,
      audience,
      note: extra.note ?? null,
      data: extra.data ?? {},
    });
  }

  // ── tracks (admin) ─────────────────────────────────────────────────────

  tracks(all = false) {
    return this.db.run((tx) => tx.select().from(paperTracks).where(all ? undefined : eq(paperTracks.active, true)).orderBy(asc(paperTracks.nameFa)));
  }

  async createTrack(input: { nameFa: string; description?: string; reviewMode: ReviewMode; maxRounds?: number; reviewerDays?: number; minReviewers?: number; reviewerDownload?: boolean }) {
    await this.assertPerm('paper.screen');
    const tenantId = requestContext.get().tenant!.id;
    const [t] = await this.db.run((tx) => tx.insert(paperTracks).values({ tenantId, ...input }).returning());
    await this.audit.record({ action: 'paper.track.created', targetType: 'paper_track', targetId: t!.id, after: input });
    return t!;
  }

  async updateTrack(id: string, input: Partial<{ nameFa: string; description: string; reviewMode: ReviewMode; maxRounds: number; reviewerDays: number; minReviewers: number; reviewerDownload: boolean; active: boolean }>) {
    await this.assertPerm('paper.screen');
    // review mode changes only affect papers submitted later: each paper keeps the mode it was submitted with (PAP-09)
    const [t] = await this.db.run((tx) => tx.update(paperTracks).set(input).where(eq(paperTracks.id, id)).returning());
    if (!t) throw new AppError('NOT_FOUND');
    await this.audit.record({ action: 'paper.track.updated', targetType: 'paper_track', targetId: id, after: input });
    return t;
  }

  // ── author ─────────────────────────────────────────────────────────────

  async createDraft(input: PaperInput) {
    const me = this.me();
    if (!(await this.acl.hasAnywhere('paper.submit'))) throw new AppError('FORBIDDEN', { permission: 'paper.submit' });
    return this.db.run(async (tx) => {
      const [track] = await tx.select().from(paperTracks).where(and(eq(paperTracks.id, input.trackId), eq(paperTracks.active, true))).limit(1);
      if (!track) throw new AppError('VALIDATION_FAILED', { field: 'trackId' });
      const [p] = await tx
        .insert(papers)
        .values({ tenantId: me.tenantId, authorMembershipId: me.membershipId, reviewMode: track.reviewMode, trackId: input.trackId, title: input.title.trim(), degree: input.degree, ...this.clean(input) })
        .returning();
      return p!;
    });
  }

  private clean(input: Partial<PaperInput>) {
    return {
      ...(input.trackId ? { trackId: input.trackId } : {}),
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.abstract !== undefined ? { abstract: input.abstract.trim() || null } : {}),
      ...(input.keywords ? { keywords: input.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 10) } : {}),
      ...(input.degree ? { degree: input.degree } : {}),
      ...(input.field !== undefined ? { field: input.field.trim() || null } : {}),
      ...(input.coAuthors ? { coAuthors: input.coAuthors.slice(0, 20) } : {}),
      ...(input.conflicts ? { conflicts: input.conflicts } : {}),
    };
  }

  async updateDraft(paperId: string, input: Partial<PaperInput>) {
    const me = this.me();
    return this.db.run(async (tx) => {
      const p = await this.load(tx, paperId);
      if (p.authorMembershipId !== me.membershipId) throw new AppError('NOT_FOUND');
      if (p.status !== 'draft') throw new AppError('INVALID_STATE_TRANSITION');
      let reviewMode = p.reviewMode;
      if (input.trackId && input.trackId !== p.trackId) {
        const [track] = await tx.select().from(paperTracks).where(and(eq(paperTracks.id, input.trackId), eq(paperTracks.active, true))).limit(1);
        if (!track) throw new AppError('VALIDATION_FAILED', { field: 'trackId' });
        reviewMode = track.reviewMode;
      }
      const [u] = await tx.update(papers).set({ ...this.clean(input), reviewMode, updatedAt: new Date() }).where(eq(papers.id, p.id)).returning();
      return u!;
    });
  }

  /** PAP-01: submit with the manuscript; tracking code issued; review mode locked (PAP-09). */
  async submit(paperId: string, manuscriptFileId: string) {
    const me = this.me();
    return this.db.run(async (tx) => {
      const p = await this.load(tx, paperId);
      if (p.authorMembershipId !== me.membershipId) throw new AppError('NOT_FOUND');
      await this.lock(tx, p, ['draft']);
      const [track] = await tx.select().from(paperTracks).where(eq(paperTracks.id, p.trackId));
      if (!track?.active) throw new AppError('VALIDATION_FAILED', { field: 'trackId' });
      const now = new Date();
      const [{ n }] = (await tx.execute<{ n: string }>(sql`select nextval('paper_tracking_seq')::text as n`)).rows as [{ n: string }];
      const trackingCode = `P-${persianYear(now)}-${n.padStart(6, '0')}`;
      const [u] = await tx
        .update(papers)
        .set({ status: 'submitted', round: 1, reviewMode: track.reviewMode, trackingCode, submittedAt: now, updatedAt: now })
        .where(eq(papers.id, p.id))
        .returning();
      await this.addVersion(tx, u!, 1, manuscriptFileId, me.userId);
      await this.event(tx, u!, 'submitted', 'all', { data: { trackingCode } });
      await this.outbox.emit('paper.submitted', { paperId: p.id }, `paper.submitted:${p.id}`);
      return u!;
    });
  }

  /** Links the author's upload and stores a scrubbed review copy next to it (PAP-10). */
  private async addVersion(tx: Executor, p: PaperRow, round: number, fileId: string, userId: string, response?: { letter?: string; fileId?: string }) {
    const [original] = await this.files.link([fileId], 'paper', p.id, { userId });
    if (original!.purpose !== 'paper_manuscript') throw new AppError('VALIDATION_FAILED', { field: 'manuscriptFileId' });
    let reviewFileId: string | null = null;
    let report: Record<string, unknown> = {};
    try {
      const scrubbed = await scrubManuscript(await this.files.read(original!), original!.mimeType);
      const ext = original!.mimeType === 'application/pdf' ? 'pdf' : 'docx';
      const copy = await this.files.upload({ purpose: 'paper_review_copy', originalName: `manuscript-r${round}.${ext}`, buffer: scrubbed.buffer, ownerUserId: null });
      await tx.update(fileObjects).set({ linkedType: 'paper', linkedId: p.id }).where(eq(fileObjects.id, copy.id));
      reviewFileId = copy.id;
      report = { ...scrubbed.report };
    } catch (err) {
      // encrypted or malformed files cannot be scrubbed; the manager sees this and decides
      report = { error: (err as Error).message.slice(0, 200) };
    }
    if (response?.fileId) await this.files.link([response.fileId], 'paper', p.id, { userId });
    await tx.insert(paperVersions).values({
      tenantId: p.tenantId,
      paperId: p.id,
      round,
      originalFileId: original!.id,
      reviewFileId,
      scrubReport: report,
      responseLetter: response?.letter?.trim() || null,
      responseFileId: response?.fileId ?? null,
    });
  }

  /** PAP-07: a revised version with the response to reviewers starts the next round. */
  async submitRevision(paperId: string, input: { manuscriptFileId: string; responseLetter?: string; responseFileId?: string }) {
    const me = this.me();
    return this.db.run(async (tx) => {
      const p = await this.load(tx, paperId);
      if (p.authorMembershipId !== me.membershipId) throw new AppError('NOT_FOUND');
      await this.lock(tx, p, ['revision_requested']);
      const round = p.round + 1;
      const [u] = await tx.update(papers).set({ status: 'revised', round, revisionDueAt: null, updatedAt: new Date() }).where(eq(papers.id, p.id)).returning();
      await this.addVersion(tx, u!, round, input.manuscriptFileId, me.userId, { letter: input.responseLetter, fileId: input.responseFileId });
      await this.event(tx, u!, 'revised', 'all');
      await this.outbox.emit('paper.revised', { paperId: p.id }, `paper.revised:${p.id}:${round}`);
      return u!;
    });
  }

  /** PAP-13: the author withdraws; active reviewers are released and told. */
  async withdraw(paperId: string, reason: string) {
    const me = this.me();
    return this.db.run(async (tx) => {
      const p = await this.load(tx, paperId);
      if (p.authorMembershipId !== me.membershipId) throw new AppError('NOT_FOUND');
      if (FINAL.includes(p.status)) throw new AppError('INVALID_STATE_TRANSITION');
      await this.lock(tx, p);
      const released = await tx
        .update(paperReviews)
        .set({ status: 'cancelled' })
        .where(and(eq(paperReviews.paperId, p.id), inArray(paperReviews.status, [...ACTIVE_REVIEW])))
        .returning({ id: paperReviews.id });
      const [u] = await tx.update(papers).set({ status: 'withdrawn', decidedAt: new Date(), updatedAt: new Date() }).where(eq(papers.id, p.id)).returning();
      await this.event(tx, u!, 'withdrawn', 'all', { note: reason });
      if (p.status !== 'draft') await this.outbox.emit('paper.withdrawn', { paperId: p.id, reviewIds: released.map((r) => r.id) }, `paper.withdrawn:${p.id}`);
      return u!;
    });
  }

  // ── manager ────────────────────────────────────────────────────────────

  /** PAP-02: send to review, ask for an initial fix, reject, or hand to another manager. */
  async screen(paperId: string, input: { decision: ScreenDecision; note?: string; revisionDays?: number; managerMembershipId?: string }) {
    await this.assertPerm('paper.screen');
    return this.db.run(async (tx) => {
      const p = await this.load(tx, paperId);
      await this.lock(tx, p, ['submitted', 'revised']);
      const now = new Date();
      let patch: Partial<PaperRow> = {};
      switch (input.decision) {
        case 'send_to_review':
          patch = { status: 'under_review' };
          break;
        case 'request_fix':
          patch = { status: 'revision_requested', revisionDueAt: new Date(now.getTime() + (input.revisionDays ?? 14) * DAY) };
          break;
        case 'reject':
          patch = { status: 'rejected', decision: 'reject', decisionNote: input.note ?? null, decidedAt: now };
          break;
        case 'forward': {
          if (!input.managerMembershipId) throw new AppError('VALIDATION_FAILED', { field: 'managerMembershipId' });
          const grants = await this.acl.loadGrants(input.managerMembershipId);
          if (!grants.some((g) => g.permission === 'paper.screen')) throw new AppError('MEMBER_NOT_ELIGIBLE', { field: 'managerMembershipId' });
          patch = { managerMembershipId: input.managerMembershipId };
          break;
        }
      }
      const [u] = await tx.update(papers).set({ ...patch, updatedAt: now }).where(eq(papers.id, p.id)).returning();
      const visible = input.decision === 'forward' ? 'managers' : 'all';
      await this.event(tx, u!, `screen.${input.decision}`, visible, { note: input.note, data: input.managerMembershipId ? { managerMembershipId: input.managerMembershipId } : {} });
      if (input.decision === 'request_fix') await this.outbox.emit('paper.revision_requested', { paperId: p.id }, `paper.revision_requested:${p.id}:${p.round}:screen`);
      if (input.decision === 'reject') await this.outbox.emit('paper.decided', { paperId: p.id, decision: 'reject' }, `paper.decided:${p.id}`);
      return u!;
    });
  }

  /**
   * PAP-04: possible conflicts of interest of a reviewer for this paper. Returns reason codes:
   * author, co_author, declared, same_unit, past_coauthor.
   */
  async conflicts(tx: Executor, p: PaperRow, reviewerMembershipId: string): Promise<string[]> {
    const out: string[] = [];
    if (reviewerMembershipId === p.authorMembershipId) out.push('author');
    if (p.coAuthors.some((c) => c.membershipId === reviewerMembershipId)) out.push('co_author');
    if (p.conflicts.membershipIds?.includes(reviewerMembershipId)) out.push('declared');
    const units = await tx
      .select({ m: membershipUnits.membershipId, u: membershipUnits.unitId })
      .from(membershipUnits)
      .where(and(inArray(membershipUnits.membershipId, [reviewerMembershipId, p.authorMembershipId]), eq(membershipUnits.isPrimary, true)));
    const a = units.find((x) => x.m === p.authorMembershipId)?.u;
    if (a && units.some((x) => x.m === reviewerMembershipId && x.u === a)) out.push('same_unit');
    const past = await tx.execute(sql`
      select 1 from papers o
      where o.id <> ${p.id} and o.status <> 'draft' and (
        (o.author_membership_id = ${p.authorMembershipId} and o.co_authors @> ${JSON.stringify([{ membershipId: reviewerMembershipId }])}::jsonb)
        or (o.author_membership_id = ${reviewerMembershipId} and o.co_authors @> ${JSON.stringify([{ membershipId: p.authorMembershipId }])}::jsonb))
      limit 1`);
    if (past.rows.length) out.push('past_coauthor');
    return out;
  }

  /** Members who may review (hold paper.review), with load and conflict hints for this paper. */
  async candidates(paperId: string) {
    await this.assertPerm('paper.assign_reviewer');
    return this.db.run(async (tx) => {
      const p = await this.load(tx, paperId);
      const rows = (
        await tx.execute<{ membership_id: string; full_name: string; unit_name: string | null; active: number; done: number }>(sql`
          select m.id as membership_id, u.full_name, ou.name_fa as unit_name,
                 (select count(*)::int from paper_reviews r where r.reviewer_membership_id = m.id and r.status in ('invited', 'accepted')) as active,
                 (select count(*)::int from paper_reviews r where r.reviewer_membership_id = m.id and r.status = 'submitted') as done
          from memberships m
          join users u on u.id = m.user_id
          left join lateral (select mu.unit_id from membership_units mu where mu.membership_id = m.id order by mu.is_primary desc limit 1) pu on true
          left join org_units ou on ou.id = pu.unit_id
          where m.status = 'active' and exists (
            select 1 from role_assignments ra
            join role_permissions rp on rp.role_id = ra.role_id and rp.permission_code = 'paper.review'
            join roles r on r.id = ra.role_id and r.archived_at is null
            where ra.membership_id = m.id and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_to is null or ra.valid_to > now()))
          order by u.full_name limit 300`)
      ).rows;
      const out = [];
      for (const r of rows) out.push({ ...r, conflicts: await this.conflicts(tx, p, r.membership_id) });
      return out;
    });
  }

  private async nextAlias(tx: Executor, p: PaperRow, who: { membershipId?: string; guestId?: string }) {
    // a reviewer keeps the same alias across rounds («داور ۲» stays «داور ۲»)
    const [prev] = await tx
      .select({ aliasNo: paperReviews.aliasNo })
      .from(paperReviews)
      .where(and(eq(paperReviews.paperId, p.id), who.membershipId ? eq(paperReviews.reviewerMembershipId, who.membershipId) : eq(paperReviews.guestId, who.guestId!)))
      .limit(1);
    if (prev) return prev.aliasNo;
    const [{ m }] = (await tx.select({ m: max(paperReviews.aliasNo) }).from(paperReviews).where(eq(paperReviews.paperId, p.id))) as [{ m: number | null }];
    return (m ?? 0) + 1;
  }

  /** PAP-03/08: invite member reviewers for the current round, each with their own deadline. */
  async assignReviewers(paperId: string, input: { reviewers: { membershipId: string; dueDays?: number }[]; acknowledgeConflicts?: boolean }) {
    await this.assertPerm('paper.assign_reviewer');
    return this.db.run(async (tx) => {
      const p = await this.load(tx, paperId);
      await this.lock(tx, p, ['under_review', 'revised', 'reviews_done']);
      const [track] = await tx.select().from(paperTracks).where(eq(paperTracks.id, p.trackId));
      const created: ReviewRow[] = [];
      const warnings: Record<string, string[]> = {};
      for (const r of input.reviewers) {
        const conflicts = await this.conflicts(tx, p, r.membershipId);
        if (conflicts.includes('author') || conflicts.includes('co_author')) throw new AppError('SEPARATION_OF_DUTIES', { membershipId: r.membershipId });
        if (conflicts.length) warnings[r.membershipId] = conflicts;
        const grants = await this.acl.loadGrants(r.membershipId);
        if (!grants.some((g) => g.permission === 'paper.review')) throw new AppError('MEMBER_NOT_ELIGIBLE', { membershipId: r.membershipId });
        const [dup] = await tx
          .select({ id: paperReviews.id })
          .from(paperReviews)
          .where(and(eq(paperReviews.paperId, p.id), eq(paperReviews.round, p.round), eq(paperReviews.reviewerMembershipId, r.membershipId), inArray(paperReviews.status, [...ACTIVE_REVIEW, 'submitted'])))
          .limit(1);
        if (dup) throw new AppError('CONFLICT', { membershipId: r.membershipId, reason: 'already_assigned' });
      }
      if (Object.keys(warnings).length && !input.acknowledgeConflicts) throw new AppError('CONFLICT_OF_INTEREST', { warnings });
      for (const r of input.reviewers) {
        const [row] = await tx
          .insert(paperReviews)
          .values({
            tenantId: p.tenantId,
            paperId: p.id,
            round: p.round,
            reviewerMembershipId: r.membershipId,
            aliasNo: await this.nextAlias(tx, p, { membershipId: r.membershipId }),
            dueAt: new Date(Date.now() + (r.dueDays ?? track!.reviewerDays) * DAY),
            conflictsAcknowledged: warnings[r.membershipId] ?? null,
          })
          .returning();
        created.push(row!);
        await this.outbox.emit('paper.review.invited', { paperId: p.id, reviewId: row!.id }, `paper.review.invited:${row!.id}`);
      }
      const [u] = await tx.update(papers).set({ status: 'under_review', updatedAt: new Date() }).where(eq(papers.id, p.id)).returning();
      await this.event(tx, u!, 'reviewers.assigned', 'managers', { data: { reviewIds: created.map((c) => c.id), conflicts: warnings } });
      if (p.status !== 'under_review') await this.event(tx, u!, 'review.started', 'author');
      if (Object.keys(warnings).length) {
        await this.audit.record({ action: 'paper.conflicts.acknowledged', targetType: 'paper', targetId: p.id, after: warnings });
      }
      return created;
    });
  }

  /** PAP-14: release an invitation (e.g. after a decline) so a replacement can be chosen. */
  async cancelReview(reviewId: string, reason: string) {
    await this.assertPerm('paper.assign_reviewer');
    return this.db.run(async (tx) => {
      const [r] = await tx.select().from(paperReviews).where(eq(paperReviews.id, reviewId)).limit(1);
      if (!r) throw new AppError('NOT_FOUND');
      if (!(ACTIVE_REVIEW as readonly string[]).includes(r.status)) throw new AppError('INVALID_STATE_TRANSITION');
      await tx.update(paperReviews).set({ status: 'cancelled' }).where(eq(paperReviews.id, r.id));
      const p = await this.load(tx, r.paperId);
      await this.event(tx, p, 'review.cancelled', 'managers', { note: reason, data: { reviewId } });
      await this.maybeReviewsDone(tx, p);
      return { id: r.id, status: 'cancelled' };
    });
  }

  /** PAP-06: final decision, or a revision request with a deadline (PAP-07). */
  async decide(paperId: string, input: { decision: Decision; note?: string; revisionDays?: number }) {
    await this.assertPerm('paper.decide');
    return this.db.run(async (tx) => {
      const p = await this.load(tx, paperId);
      await this.lock(tx, p, ['under_review', 'reviews_done']);
      const now = new Date();
      const revise = input.decision === 'minor_revision' || input.decision === 'major_revision';
      if (revise) {
        const [track] = await tx.select().from(paperTracks).where(eq(paperTracks.id, p.trackId));
        if (p.round >= track!.maxRounds) throw new AppError('MAX_ROUNDS_REACHED', { maxRounds: track!.maxRounds });
      }
      // invitations still open for this round are released
      await tx.update(paperReviews).set({ status: 'cancelled' }).where(and(eq(paperReviews.paperId, p.id), eq(paperReviews.round, p.round), inArray(paperReviews.status, [...ACTIVE_REVIEW])));
      const status: PaperStatus = revise ? 'revision_requested' : input.decision === 'accept' ? 'accepted' : input.decision === 'accept_conditional' ? 'accepted_conditional' : 'rejected';
      const [u] = await tx
        .update(papers)
        .set({
          status,
          decision: input.decision,
          decisionNote: input.note ?? null,
          revisionDueAt: revise ? new Date(now.getTime() + (input.revisionDays ?? 30) * DAY) : null,
          decidedAt: revise ? null : now,
          updatedAt: now,
        })
        .where(eq(papers.id, p.id))
        .returning();
      await this.event(tx, u!, revise ? 'revision.requested' : 'decided', 'all', { note: input.note, data: { decision: input.decision } });
      await this.outbox.emit(revise ? 'paper.revision_requested' : 'paper.decided', { paperId: p.id, decision: input.decision }, `paper.decision:${p.id}:${p.round}`);
      return u!;
    });
  }

  // ── reviewer (member or guest) ─────────────────────────────────────────

  async reviewFor(tx: Executor, reviewId: string, who: { membershipId?: string; guestId?: string }) {
    const [r] = await tx.select().from(paperReviews).where(eq(paperReviews.id, reviewId)).limit(1);
    const mine = r && (who.membershipId ? r.reviewerMembershipId === who.membershipId : r.guestId === who.guestId);
    if (!r || !mine) throw new AppError('NOT_FOUND');
    return r;
  }

  async respond(reviewId: string, who: { membershipId?: string; guestId?: string }, accept: boolean, reason?: string) {
    return this.db.run(async (tx) => {
      const r = await this.reviewFor(tx, reviewId, who);
      if (r.status !== 'invited') throw new AppError('INVALID_STATE_TRANSITION');
      const p = await this.load(tx, r.paperId);
      if (FINAL.includes(p.status)) throw new AppError('INVALID_STATE_TRANSITION');
      await tx
        .update(paperReviews)
        .set({ status: accept ? 'accepted' : 'declined', respondedAt: new Date(), declineReason: accept ? null : (reason ?? null) })
        .where(eq(paperReviews.id, r.id));
      await this.event(tx, p, accept ? 'review.accepted' : 'review.declined', 'managers', { note: reason, data: { reviewId: r.id, alias: r.aliasNo }, guestId: who.guestId });
      if (!accept) {
        await this.outbox.emit('paper.review.declined', { paperId: p.id, reviewId: r.id }, `paper.review.declined:${r.id}`);
        await this.maybeReviewsDone(tx, p);
      }
      return { id: r.id, status: accept ? 'accepted' : 'declined' };
    });
  }

  /** PAP-05: recommendation, text for the author, confidential text for the manager, optional file. */
  async submitReview(
    reviewId: string,
    who: { membershipId?: string; guestId?: string; userId?: string },
    input: { recommendation: Recommendation; commentsToAuthor: string; confidentialComments?: string; scores?: Record<string, number>; attachmentFileId?: string },
  ) {
    return this.db.run(async (tx) => {
      const r = await this.reviewFor(tx, reviewId, who);
      if (r.status !== 'accepted') throw new AppError('INVALID_STATE_TRANSITION', { status: r.status });
      const p = await this.load(tx, r.paperId);
      if (p.status !== 'under_review' || p.round !== r.round) throw new AppError('INVALID_STATE_TRANSITION');
      if (input.attachmentFileId) {
        const [f] = who.userId
          ? await this.files.link([input.attachmentFileId], 'paper', p.id, { userId: who.userId })
          : await tx.update(fileObjects).set({ linkedType: 'paper', linkedId: p.id }).where(and(eq(fileObjects.id, input.attachmentFileId), isNull(fileObjects.linkedId), isNull(fileObjects.ownerUserId), eq(fileObjects.uploadSubject, `guest:${who.guestId}`))).returning();
        if (!f || f.purpose !== 'paper_review_attachment') throw new AppError('VALIDATION_FAILED', { field: 'attachmentFileId' });
      }
      const scores = Object.fromEntries(Object.entries(input.scores ?? {}).filter(([k, v]) => /^[a-z_]{1,30}$/.test(k) && Number.isFinite(v) && v >= 0 && v <= 10).slice(0, 10));
      await tx
        .update(paperReviews)
        .set({
          status: 'submitted',
          submittedAt: new Date(),
          recommendation: input.recommendation,
          commentsToAuthor: input.commentsToAuthor.trim(),
          confidentialComments: input.confidentialComments?.trim() || null,
          scores,
          attachmentFileId: input.attachmentFileId ?? null,
        })
        .where(eq(paperReviews.id, r.id));
      await this.event(tx, p, 'review.submitted', 'managers', { data: { reviewId: r.id, alias: r.aliasNo }, guestId: who.guestId });
      await this.maybeReviewsDone(tx, p);
      return { id: r.id, status: 'submitted' };
    });
  }

  /** When no invitation of the round is still open and at least one review is in, the paper waits on the decision. */
  private async maybeReviewsDone(tx: Executor, p: PaperRow) {
    if (p.status !== 'under_review') return;
    const rows = await tx.select({ status: paperReviews.status }).from(paperReviews).where(and(eq(paperReviews.paperId, p.id), eq(paperReviews.round, p.round)));
    const open = rows.some((r) => r.status === 'invited' || r.status === 'accepted');
    const submitted = rows.filter((r) => r.status === 'submitted').length;
    if (open || submitted === 0) return;
    await tx.update(papers).set({ status: 'reviews_done', updatedAt: new Date() }).where(eq(papers.id, p.id));
    await this.event(tx, p, 'reviews.done', 'managers');
    await this.outbox.emit('paper.reviews_done', { paperId: p.id }, `paper.reviews_done:${p.id}:${p.round}`);
  }

  /** PAP-12: reminders before and after a reviewer's deadline (hourly sweep). */
  async remindReviewers(now = new Date()) {
    const due = await this.db.sys
      .select()
      .from(paperReviews)
      .where(and(inArray(paperReviews.status, [...ACTIVE_REVIEW]), sql`(${paperReviews.remindedAt} is null and ${paperReviews.dueAt} < ${new Date(now.getTime() + 2 * DAY)})
        or (${paperReviews.remindedAt} < ${paperReviews.dueAt} and ${paperReviews.dueAt} < ${now})`));
    for (const r of due) {
      await this.db.transaction({ tenantId: r.tenantId }, async (tx) => {
        await tx.update(paperReviews).set({ remindedAt: now }).where(eq(paperReviews.id, r.id));
        const kind = r.dueAt < now ? 'overdue' : 'soon';
        await requestContext.run({ requestId: `paper-remind:${r.id}`, tenant: { id: r.tenantId, slug: '', status: 'active' }, tx }, () =>
          this.outbox.emit('paper.review.reminder', { paperId: r.paperId, reviewId: r.id, kind }, `paper.review.reminder:${r.id}:${kind}`),
        );
      });
    }
    return due.length;
  }

  /** The file a reviewer may read for their round (scrubbed copy in double-blind). */
  async manuscriptFor(reviewId: string, who: { membershipId?: string; guestId?: string }) {
    return this.db.run(async (tx) => {
      const r = await this.reviewFor(tx, reviewId, who);
      if (r.status !== 'accepted' && r.status !== 'submitted') throw new AppError('FORBIDDEN');
      const p = await this.load(tx, r.paperId);
      const [v] = await tx.select().from(paperVersions).where(and(eq(paperVersions.paperId, p.id), eq(paperVersions.round, r.round)));
      const fileId = p.reviewMode === 'double_blind' ? v?.reviewFileId : v?.originalFileId;
      if (!fileId) throw new AppError('FILE_NOT_READY');
      const [f] = await tx.select().from(fileObjects).where(eq(fileObjects.id, fileId));
      return f!;
    });
  }

  async guestAudit(guestId: string, action: string, paperId: string) {
    await this.audit.record({ action, actorType: 'system', targetType: 'paper', targetId: paperId, after: { guestId } });
  }

  // ── lists ──────────────────────────────────────────────────────────────

  myPapers() {
    const me = this.me();
    return this.db.run((tx) =>
      tx
        .select({
          id: papers.id,
          trackingCode: papers.trackingCode,
          title: papers.title,
          status: papers.status,
          round: papers.round,
          revisionDueAt: papers.revisionDueAt,
          createdAt: papers.createdAt,
          submittedAt: papers.submittedAt,
          trackName: paperTracks.nameFa,
        })
        .from(papers)
        .innerJoin(paperTracks, eq(paperTracks.id, papers.trackId))
        .where(eq(papers.authorMembershipId, me.membershipId))
        .orderBy(desc(papers.createdAt)),
    );
  }

  async adminList(q: { status?: PaperStatus; q?: string; limit: number; offset: number }) {
    if (!(await this.isManager())) throw new AppError('FORBIDDEN');
    return this.db.run(async (tx) => {
      const where = sql`where p.status <> 'draft' ${q.status ? sql`and p.status = ${q.status}` : sql``}
        ${q.q ? sql`and (p.title ilike ${'%' + q.q + '%'} or p.tracking_code ilike ${'%' + q.q + '%'})` : sql``}`;
      const items = (
        await tx.execute(sql`
          select p.id, p.tracking_code, p.title, p.status, p.round, p.review_mode, p.submitted_at, p.updated_at, t.name_fa as track_name,
                 u.full_name as author_name,
                 (select count(*)::int from paper_reviews r where r.paper_id = p.id and r.round = p.round and r.status = 'submitted') as reviews_in,
                 (select count(*)::int from paper_reviews r where r.paper_id = p.id and r.round = p.round and r.status in ('invited', 'accepted', 'submitted')) as reviews_total
          from papers p join paper_tracks t on t.id = p.track_id
          join memberships m on m.id = p.author_membership_id join users u on u.id = m.user_id
          ${where} order by p.updated_at desc limit ${q.limit} offset ${q.offset}`)
      ).rows;
      const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from papers p ${where}`)).rows as [{ n: number }];
      return { items, total: n };
    });
  }

  myReviews() {
    const me = this.me();
    return this.db.run(async (tx) =>
      (
        await tx.execute(sql`
          select r.id, r.status, r.round, r.due_at, r.invited_at, r.alias_no, p.title, p.tracking_code, p.status as paper_status, t.name_fa as track_name
          from paper_reviews r join papers p on p.id = r.paper_id join paper_tracks t on t.id = p.track_id
          where r.reviewer_membership_id = ${me.membershipId} and r.status <> 'cancelled'
          order by (r.status in ('invited', 'accepted')) desc, r.due_at asc`)
      ).rows,
    );
  }
}

export { ACTIVE_REVIEW, FINAL };
