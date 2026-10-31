import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { DbService, type Executor } from '../../database/db.service.js';
import { fileObjects, memberships, paperEvents, paperGuests, paperReviews, papers, paperTracks, paperVersions, users } from '../../database/schema.js';
import { FINAL, PapersService, type PaperRow, type ReviewRow } from './papers.service.js';

/** Dates shown across the review boundary are cut to the day (timing hints, section 9). */
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const alias = (n: number) => `داور ${n.toLocaleString('fa-IR')}`;

type FileMeta = { id: string; originalName: string; mimeType: string; sizeBytes: number; scanStatus: string };

/**
 * One builder per audience (section 9 identity matrix). Nothing is filtered in the client: a
 * response only ever contains what that audience may see.
 */
@Injectable()
export class PaperViews {
  constructor(
    private readonly db: DbService,
    private readonly papers: PapersService,
  ) {}

  private async files(tx: Executor, ids: (string | null)[]): Promise<Map<string, FileMeta>> {
    const list = ids.filter((x): x is string => !!x);
    if (!list.length) return new Map();
    const rows = await tx
      .select({ id: fileObjects.id, originalName: fileObjects.originalName, mimeType: fileObjects.mimeType, sizeBytes: fileObjects.sizeBytes, scanStatus: fileObjects.scanStatus })
      .from(fileObjects)
      .where(inArray(fileObjects.id, list));
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async names(tx: Executor, membershipIds: (string | null)[]) {
    const ids = membershipIds.filter((x): x is string => !!x);
    if (!ids.length) return new Map<string, string>();
    const rows = await tx.select({ id: memberships.id, name: users.fullName }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(inArray(memberships.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** The author's view: own paper, versions, reviews of decided rounds (alias only unless open review). */
  async author(paperId: string) {
    const me = requestContext.get().membershipId;
    return this.db.run(async (tx) => {
      const p = await this.papers.load(tx, paperId);
      if (p.authorMembershipId !== me) throw new AppError('NOT_FOUND');
      const [track] = await tx.select().from(paperTracks).where(eq(paperTracks.id, p.trackId));
      const versions = await tx.select().from(paperVersions).where(eq(paperVersions.paperId, p.id)).orderBy(asc(paperVersions.round));
      const fm = await this.files(tx, versions.flatMap((v) => [v.originalFileId, v.responseFileId]));
      // reviews become visible once the manager has decided on their round
      const decidedRound = p.status === 'revision_requested' || FINAL.includes(p.status) ? p.round : p.round - 1;
      const reviews = await tx
        .select()
        .from(paperReviews)
        .where(and(eq(paperReviews.paperId, p.id), eq(paperReviews.status, 'submitted')))
        .orderBy(asc(paperReviews.round), asc(paperReviews.aliasNo));
      const visible = p.status === 'withdrawn' ? [] : reviews.filter((r) => r.round <= decidedRound);
      const named = p.reviewMode === 'open' ? await this.names(tx, visible.map((r) => r.reviewerMembershipId)) : new Map<string, string>();
      const guests = p.reviewMode === 'open' ? await this.guestNames(tx, visible) : new Map<string, string>();
      const events = await tx
        .select()
        .from(paperEvents)
        .where(and(eq(paperEvents.paperId, p.id), inArray(paperEvents.audience, ['all', 'author'])))
        .orderBy(asc(paperEvents.occurredAt));
      return {
        view: 'author' as const,
        ...this.base(p),
        trackName: track!.nameFa,
        conference: await this.conference(tx, p.eventId),
        coAuthors: p.coAuthors,
        conflicts: p.conflicts,
        canWithdraw: !FINAL.includes(p.status),
        canRevise: p.status === 'revision_requested',
        versions: versions.map((v) => ({
          round: v.round,
          file: fm.get(v.originalFileId) ?? null,
          responseLetter: v.responseLetter,
          responseFile: v.responseFileId ? (fm.get(v.responseFileId) ?? null) : null,
          createdAt: day(v.createdAt),
        })),
        reviews: visible.map((r) => ({
          round: r.round,
          reviewer: p.reviewMode === 'open' ? (named.get(r.reviewerMembershipId ?? '') ?? guests.get(r.guestId ?? '') ?? alias(r.aliasNo)) : alias(r.aliasNo),
          commentsToAuthor: r.commentsToAuthor,
        })),
        history: events.map((e) => ({ type: e.type, round: e.round, date: day(e.occurredAt), note: e.note, data: pick(e.data, ['trackingCode', 'decision']) })),
      };
    });
  }

  private async guestNames(tx: Executor, reviews: ReviewRow[]) {
    const ids = reviews.map((r) => r.guestId).filter((x): x is string => !!x);
    if (!ids.length) return new Map<string, string>();
    const rows = await tx.select({ id: paperGuests.id, name: paperGuests.fullName }).from(paperGuests).where(inArray(paperGuests.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private base(p: PaperRow) {
    return {
      id: p.id,
      trackingCode: p.trackingCode,
      title: p.title,
      abstract: p.abstract,
      keywords: p.keywords,
      degree: p.degree,
      field: p.field,
      status: p.status,
      round: p.round,
      reviewMode: p.reviewMode,
      revisionDueAt: p.revisionDueAt,
      decision: p.decision,
      decisionNote: p.decisionNote,
      submittedAt: day(p.submittedAt),
      lockVersion: p.lockVersion,
    };
  }

  /**
   * A reviewer's view (member or guest): the paper without the author in double-blind mode, the
   * manuscript of their round, their own review — never other reviewers.
   */
  async reviewer(reviewId: string, who: { membershipId?: string; guestId?: string }) {
    return this.db.run(async (tx) => {
      const r = await this.papers.reviewFor(tx, reviewId, who);
      if (r.status === 'cancelled') throw new AppError('NOT_FOUND');
      const p = await this.papers.load(tx, r.paperId);
      const [track] = await tx.select().from(paperTracks).where(eq(paperTracks.id, p.trackId));
      const [version] = await tx.select().from(paperVersions).where(and(eq(paperVersions.paperId, p.id), eq(paperVersions.round, r.round)));
      const fileId = p.reviewMode === 'double_blind' ? version?.reviewFileId : version?.originalFileId;
      const showAuthor = p.reviewMode !== 'double_blind';
      const authorName = showAuthor ? (await this.names(tx, [p.authorMembershipId])).get(p.authorMembershipId) : null;
      const [file] = fileId ? [...(await this.files(tx, [fileId])).values()] : [];
      const previous = await tx
        .select()
        .from(paperReviews)
        .where(and(eq(paperReviews.paperId, p.id), who.membershipId ? eq(paperReviews.reviewerMembershipId, who.membershipId) : eq(paperReviews.guestId, who.guestId!), eq(paperReviews.status, 'submitted')))
        .orderBy(asc(paperReviews.round));
      const active = (r.status === 'invited' || r.status === 'accepted') && !FINAL.includes(p.status);
      return {
        view: 'reviewer' as const,
        review: {
          id: r.id,
          status: r.status,
          round: r.round,
          alias: alias(r.aliasNo),
          dueAt: day(r.dueAt),
          recommendation: r.recommendation,
          commentsToAuthor: r.commentsToAuthor,
          confidentialComments: r.confidentialComments,
          scores: r.scores,
          canRespond: r.status === 'invited' && active,
          canSubmit: r.status === 'accepted' && p.status === 'under_review' && p.round === r.round,
        },
        paper: {
          title: p.title,
          abstract: p.abstract,
          keywords: p.keywords,
          degree: p.degree,
          field: p.field,
          trackName: track!.nameFa,
          reviewMode: p.reviewMode,
          closed: FINAL.includes(p.status),
          author: showAuthor ? { fullName: authorName ?? null, coAuthors: p.coAuthors.map((c) => c.fullName) } : null,
        },
        manuscript:
          file && (r.status === 'accepted' || r.status === 'submitted')
            ? {
                // members download through a file link; guests through their own route
                fileId: who.membershipId && track!.reviewerDownload ? file.id : null,
                name: `manuscript-r${r.round}.${file.mimeType === 'application/pdf' ? 'pdf' : 'docx'}`,
                sizeBytes: file.sizeBytes,
                downloadAllowed: track!.reviewerDownload,
                ready: file.scanStatus === 'clean' || file.scanStatus === 'skipped',
              }
            : null,
        responseLetter: r.round > 1 ? (version?.responseLetter ?? null) : null,
        previousRounds: previous.filter((x) => x.round < r.round).map((x) => ({ round: x.round, recommendation: x.recommendation, commentsToAuthor: x.commentsToAuthor })),
      };
    });
  }

  /** The review manager's view: everything, including identities and confidential comments. */
  async manager(paperId: string) {
    if (!(await this.papers.isManager())) throw new AppError('NOT_FOUND');
    return this.db.run(async (tx) => {
      const p = await this.papers.load(tx, paperId);
      if (p.status === 'draft') throw new AppError('NOT_FOUND');
      const [track] = await tx.select().from(paperTracks).where(eq(paperTracks.id, p.trackId));
      const versions = await tx.select().from(paperVersions).where(eq(paperVersions.paperId, p.id)).orderBy(asc(paperVersions.round));
      const reviews = await tx.select().from(paperReviews).where(eq(paperReviews.paperId, p.id)).orderBy(asc(paperReviews.round), asc(paperReviews.aliasNo));
      const fm = await this.files(tx, [...versions.flatMap((v) => [v.originalFileId, v.reviewFileId, v.responseFileId]), ...reviews.map((r) => r.attachmentFileId)]);
      const names = await this.names(tx, [p.authorMembershipId, p.managerMembershipId, ...reviews.map((r) => r.reviewerMembershipId)]);
      const guests = await tx.select().from(paperGuests).where(inArray(paperGuests.id, reviews.map((r) => r.guestId).filter((x): x is string => !!x).concat('00000000-0000-0000-0000-000000000000')));
      const [author] = await tx.select({ memberNo: memberships.memberNo }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.id, p.authorMembershipId));
      const events = await tx
        .select({ e: paperEvents, actor: users.fullName })
        .from(paperEvents)
        .leftJoin(users, eq(users.id, paperEvents.actorUserId))
        .where(eq(paperEvents.paperId, p.id))
        .orderBy(asc(paperEvents.occurredAt));
      return {
        view: 'manager' as const,
        ...this.base(p),
        submittedAt: p.submittedAt,
        trackName: track!.nameFa,
        conference: await this.conference(tx, p.eventId),
        track: { maxRounds: track!.maxRounds, minReviewers: track!.minReviewers, reviewerDays: track!.reviewerDays },
        author: { membershipId: p.authorMembershipId, fullName: names.get(p.authorMembershipId) ?? null, memberNo: author?.memberNo ?? null },
        manager: p.managerMembershipId ? { membershipId: p.managerMembershipId, fullName: names.get(p.managerMembershipId) ?? null } : null,
        coAuthors: p.coAuthors,
        conflicts: p.conflicts,
        versions: versions.map((v) => ({
          round: v.round,
          original: fm.get(v.originalFileId) ?? null,
          reviewCopy: v.reviewFileId ? (fm.get(v.reviewFileId) ?? null) : null,
          scrubReport: v.scrubReport,
          responseLetter: v.responseLetter,
          responseFile: v.responseFileId ? (fm.get(v.responseFileId) ?? null) : null,
          createdAt: v.createdAt,
        })),
        reviews: reviews.map((r) => {
          const g = guests.find((x) => x.id === r.guestId);
          return {
            id: r.id,
            round: r.round,
            alias: alias(r.aliasNo),
            reviewer: r.reviewerMembershipId
              ? { type: 'member' as const, membershipId: r.reviewerMembershipId, fullName: names.get(r.reviewerMembershipId) ?? null }
              : { type: 'guest' as const, guestId: g?.id ?? null, fullName: g?.fullName ?? null, expiresAt: g?.expiresAt ?? null, revoked: !!g?.revokedAt },
            status: r.status,
            dueAt: r.dueAt,
            invitedAt: r.invitedAt,
            respondedAt: r.respondedAt,
            submittedAt: r.submittedAt,
            declineReason: r.declineReason,
            recommendation: r.recommendation,
            commentsToAuthor: r.commentsToAuthor,
            confidentialComments: r.confidentialComments,
            scores: r.scores,
            attachment: r.attachmentFileId ? (fm.get(r.attachmentFileId) ?? null) : null,
            conflictsAcknowledged: r.conflictsAcknowledged,
          };
        }),
        history: events.map(({ e, actor }) => ({ type: e.type, round: e.round, occurredAt: e.occurredAt, audience: e.audience, actorName: actor, note: e.note, data: e.data })),
      };
    });
  }

  /** The conference (event) a paper was submitted to, if any (EVT-11). */
  private async conference(tx: Executor, eventId: string | null) {
    if (!eventId) return null;
    const r = (await tx.execute<{ id: string; title: string }>(sql`select id, title from events where id = ${eventId}`)).rows[0];
    return r ?? null;
  }
}

const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
