import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, desc, eq, ne } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { hmac, randomToken } from '../../common/util/crypto.js';
import { normalizeMobile } from '../../common/util/normalize.js';
import { ENV, type Env } from '../../config/env.js';
import { DbService } from '../../database/db.service.js';
import { paperGuests, paperReviews, papers, paperTracks, tenants } from '../../database/schema.js';
import { SmsProvider } from '../../infra/sms.js';
import { AuditService } from '../audit/audit.service.js';
import { PapersService } from './papers.service.js';

const DAY = 86_400_000;

interface GuestClaims {
  gid: string;
  tid: string;
  typ: 'paper_guest';
}

/**
 * Guest reviewers (PAP-11): no account; a one-time link becomes a short session limited to their
 * own review. Expiry and revocation are checked on every request.
 */
@Injectable()
export class GuestsService {
  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly papers: PapersService,
    private readonly sms: SmsProvider,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private hash(token: string) {
    return hmac(this.env.HASH_PEPPER, `paper-guest:${token}`);
  }

  private link(token: string) {
    return `${this.env.PORTAL_URL}/review/${token}`;
  }

  /** Manager invites a guest for the current round; returns the link to share as well. */
  async invite(paperId: string, input: { fullName: string; mobile?: string; email?: string; dueDays?: number; expiresDays?: number }) {
    if (!(await this.papers.isManager())) throw new AppError('FORBIDDEN');
    const ctx = requestContext.get();
    const mobile = input.mobile ? normalizeMobile(input.mobile) : null;
    if (input.mobile && !mobile) throw new AppError('VALIDATION_FAILED', { field: 'mobile' });
    const token = randomToken(24);
    const result = await this.db.run(async (tx) => {
      const p = await this.papers.load(tx, paperId);
      if (!['under_review', 'revised', 'reviews_done'].includes(p.status)) throw new AppError('INVALID_STATE_TRANSITION', { status: p.status });
      const [track] = await tx.select().from(paperTracks).where(eq(paperTracks.id, p.trackId));
      const dueDays = input.dueDays ?? track!.reviewerDays;
      const [g] = await tx
        .insert(paperGuests)
        .values({
          tenantId: p.tenantId,
          fullName: input.fullName.trim(),
          mobile,
          email: input.email?.trim() || null,
          tokenHash: this.hash(token),
          expiresAt: new Date(Date.now() + (input.expiresDays ?? dueDays + 30) * DAY),
          createdBy: ctx.userId,
        })
        .returning();
      const [prev] = await tx.select({ m: paperReviews.aliasNo }).from(paperReviews).where(eq(paperReviews.paperId, p.id)).orderBy(desc(paperReviews.aliasNo)).limit(1);
      const [r] = await tx
        .insert(paperReviews)
        .values({ tenantId: p.tenantId, paperId: p.id, round: p.round, guestId: g!.id, aliasNo: (prev?.m ?? 0) + 1, dueAt: new Date(Date.now() + dueDays * DAY) })
        .returning();
      if (p.status !== 'under_review') await tx.update(papers).set({ status: 'under_review', updatedAt: new Date() }).where(eq(papers.id, p.id));
      await this.papers.event(tx, p, 'guest.invited', 'managers', { data: { reviewId: r!.id, guestId: g!.id } });
      return { guest: g!, review: r! };
    });
    await this.audit.record({ action: 'paper.guest.invited', targetType: 'paper', targetId: paperId, after: { guestId: result.guest.id, reviewId: result.review.id } });
    // the link is only ever sent, never stored: the database keeps its hash
    if (mobile) await this.sms.send({ to: mobile, text: `دعوت به داوری یک مقاله. برای مشاهده و پاسخ: ${this.link(token)}`, tenantId: ctx.tenant!.id });
    return { guestId: result.guest.id, reviewId: result.review.id, inviteUrl: this.link(token), expiresAt: result.guest.expiresAt };
  }

  /** New one-time link (e.g. the guest changed device); the old one stops working. */
  async reissue(guestId: string) {
    if (!(await this.papers.isManager())) throw new AppError('FORBIDDEN');
    const token = randomToken(24);
    const [guest] = await this.db.run((tx) => tx.select().from(paperGuests).where(eq(paperGuests.id, guestId)).limit(1));
    if (!guest || guest.revokedAt) throw new AppError('NOT_FOUND');
    await this.db.run((tx) => tx.update(paperGuests).set({ tokenHash: this.hash(token), tokenUsedAt: null }).where(eq(paperGuests.id, guestId)));
    await this.audit.record({ action: 'paper.guest.link_reissued', targetType: 'paper_guest', targetId: guestId });
    if (guest.mobile) await this.sms.send({ to: guest.mobile, text: `لینک تازه داوری مقاله: ${this.link(token)}`, tenantId: guest.tenantId });
    return { inviteUrl: this.link(token) };
  }

  async revoke(guestId: string, reason: string) {
    if (!(await this.papers.isManager())) throw new AppError('FORBIDDEN');
    const [g] = await this.db.run((tx) => tx.update(paperGuests).set({ revokedAt: new Date() }).where(eq(paperGuests.id, guestId)).returning());
    if (!g) throw new AppError('NOT_FOUND');
    await this.audit.record({ action: 'paper.guest.revoked', targetType: 'paper_guest', targetId: guestId, reason });
    return { id: g.id, revokedAt: g.revokedAt };
  }

  /** Exchanges the one-time link for a session token scoped to this guest. */
  async session(token: string) {
    const [g] = await this.db.sys.select().from(paperGuests).where(eq(paperGuests.tokenHash, this.hash(token))).limit(1);
    if (!g || g.tokenUsedAt || g.revokedAt || g.expiresAt < new Date()) throw new AppError('GUEST_LINK_INVALID');
    await this.db.sys.update(paperGuests).set({ tokenUsedAt: new Date() }).where(eq(paperGuests.id, g.id));
    const ttl = Math.max(60, Math.floor((g.expiresAt.getTime() - Date.now()) / 1000));
    const claims: GuestClaims = { gid: g.id, tid: g.tenantId, typ: 'paper_guest' };
    await this.audit.recordDetached({ action: 'paper.guest.session', tenantId: g.tenantId, actorType: 'system', targetType: 'paper_guest', targetId: g.id });
    return { sessionToken: this.jwt.sign(claims, { secret: this.env.JWT_PROOF_SECRET, expiresIn: Math.min(ttl, 7 * 86_400), algorithm: 'HS256' }), expiresAt: g.expiresAt, fullName: g.fullName };
  }

  /** Verifies a guest session and returns the guest (guard). */
  async verify(sessionToken: string) {
    let claims: GuestClaims;
    try {
      claims = this.jwt.verify<GuestClaims>(sessionToken, { secret: this.env.JWT_PROOF_SECRET, algorithms: ['HS256'] });
    } catch {
      throw new AppError('GUEST_LINK_INVALID');
    }
    if (claims.typ !== 'paper_guest') throw new AppError('GUEST_LINK_INVALID');
    const [g] = await this.db.sys.select().from(paperGuests).where(eq(paperGuests.id, claims.gid)).limit(1);
    if (!g || g.revokedAt || g.expiresAt < new Date()) throw new AppError('GUEST_LINK_INVALID');
    const [t] = await this.db.sys.select({ id: tenants.id, slug: tenants.slug, status: tenants.status }).from(tenants).where(eq(tenants.id, g.tenantId));
    if (!t || t.status !== 'active') throw new AppError('TENANT_UNAVAILABLE');
    return { guest: g, tenant: t };
  }

  /** The guest's current review (latest round they were invited to, not cancelled). */
  async currentReview(guestId: string) {
    const [r] = await this.db.run((tx) =>
      tx.select().from(paperReviews).where(and(eq(paperReviews.guestId, guestId), ne(paperReviews.status, 'cancelled'))).orderBy(desc(paperReviews.round)).limit(1),
    );
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }
}

/** Accepts `x-guest-token` and puts the guest and their tenant in the request context. */
@Injectable()
export class GuestGuard implements CanActivate {
  constructor(private readonly guests: GuestsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const token = req.headers['x-guest-token'];
    if (!token) throw new AppError('GUEST_LINK_INVALID');
    const { guest, tenant } = await this.guests.verify(token);
    const ctx = requestContext.get();
    ctx.guestId = guest.id;
    ctx.tenant = tenant;
    return true;
  }
}
