import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { DbService, type Executor } from '../../database/db.service.js';
import {
  fileObjects,
  memberships,
  newsApprovals,
  newsChannelMembers,
  newsChannels,
  newsEvents,
  newsPosts,
  newsPostVersions,
  users,
  type Audience,
  type NewsStatus,
  tenants,
} from '../../database/schema.js';
import { AclService } from '../acl/acl.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FilesService } from '../files/files.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { audienceMatch, cleanAudience, loadViewer, type Viewer } from './audience.js';
import { cleanHtml, plainText } from './html.js';

type PostRow = typeof newsPosts.$inferSelect;
export type ChannelRole = 'author' | 'approver' | 'publisher';

export interface PostInput {
  channelId: string;
  title: string;
  summary?: string;
  bodyHtml?: string;
  coverFileId?: string | null;
  attachmentFileIds?: string[];
  category?: string;
  tags?: string[];
  source?: string;
  audience: Audience;
  expireAt?: string | null;
}

/** Readable, unique slug: Persian words joined by dashes plus a short suffix (NWS-14). */
const slugify = (title: string) =>
  `${title
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .split(/\s+/)
    .slice(0, 8)
    .join('-')
    .toLowerCase()
    .slice(0, 80)}-${randomBytes(3).toString('hex')}`;

/**
 * News (section 10): who may *see* a post (its audience) and who may *write, approve or publish*
 * (channel roles + tenant-wide news.* permissions) are independent (NWS-02).
 */
@Injectable()
export class NewsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly acl: AclService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit() {
    // NWS-09: attachments of a post are readable exactly when the post is (or by its editors)
    this.files.registerAccessResolver('news', async (file) => {
      const ctx = requestContext.find();
      return this.db.run(async (tx) => {
        const [p] = await tx.select().from(newsPosts).where(eq(newsPosts.id, file.linkedId!)).limit(1);
        if (!p) return false;
        if (ctx?.membershipId && (await this.rolesIn(tx, p.channelId)).size) return true;
        return !!(await this.visible(tx, p.id));
      });
    });
  }

  // ── roles ──────────────────────────────────────────────────────────────

  private me() {
    const ctx = requestContext.get();
    if (!ctx.membershipId || !ctx.userId) throw new AppError('MEMBERSHIP_REQUIRED');
    return { membershipId: ctx.membershipId, userId: ctx.userId, tenantId: ctx.tenant!.id };
  }

  /** Channel roles of the caller: explicit channel membership plus tenant-wide news permissions. */
  async rolesIn(tx: Executor, channelId: string): Promise<Set<ChannelRole>> {
    const ctx = requestContext.find();
    const roles = new Set<ChannelRole>();
    if (!ctx?.membershipId || ctx.membershipStatus !== 'active') return roles;
    const rows = await tx
      .select({ role: newsChannelMembers.role })
      .from(newsChannelMembers)
      .where(and(eq(newsChannelMembers.channelId, channelId), eq(newsChannelMembers.membershipId, ctx.membershipId)));
    for (const r of rows) roles.add(r.role);
    if (await this.acl.has('news.create')) roles.add('author');
    if (await this.acl.has('news.approve')) roles.add('approver');
    if (await this.acl.has('news.publish')) roles.add('publisher');
    return roles;
  }

  private async need(tx: Executor, channelId: string, ...any: ChannelRole[]) {
    const roles = await this.rolesIn(tx, channelId);
    if (!any.some((r) => roles.has(r))) throw new AppError('FORBIDDEN', { channelRoles: any });
    return roles;
  }

  private async load(tx: Executor, id: string): Promise<PostRow> {
    const [p] = await tx.select().from(newsPosts).where(eq(newsPosts.id, id)).limit(1);
    if (!p || p.status === 'deleted') throw new AppError('NOT_FOUND');
    return p;
  }

  private async lock(tx: Executor, p: PostRow, expected?: NewsStatus[]) {
    if (expected && !expected.includes(p.status)) throw new AppError('INVALID_STATE_TRANSITION', { status: p.status });
    const r = await tx
      .update(newsPosts)
      .set({ lockVersion: sql`${newsPosts.lockVersion} + 1`, updatedAt: new Date() })
      .where(and(eq(newsPosts.id, p.id), eq(newsPosts.lockVersion, p.lockVersion)))
      .returning({ id: newsPosts.id });
    if (!r.length) throw new AppError('CASE_STALE');
  }

  private async event(tx: Executor, p: Pick<PostRow, 'id' | 'tenantId' | 'version'>, type: string, note?: string) {
    await tx.insert(newsEvents).values({ tenantId: p.tenantId, postId: p.id, actorUserId: requestContext.find()?.userId ?? null, type, version: p.version, note: note ?? null });
  }

  // ── channels (NWS-04/05) ───────────────────────────────────────────────

  async channels() {
    return this.db.run(async (tx) => {
      const all = await tx.select().from(newsChannels).orderBy(asc(newsChannels.nameFa));
      const manage = await this.acl.hasAnywhere('news.manage');
      const out = [];
      for (const c of all) {
        const roles = [...(await this.rolesIn(tx, c.id))];
        if (manage || roles.length) out.push({ ...c, myRoles: roles });
      }
      return out;
    });
  }

  private async assertManage() {
    if (!(await this.acl.hasAnywhere('news.manage'))) throw new AppError('FORBIDDEN', { permission: 'news.manage' });
  }

  async createChannel(input: { nameFa: string; description?: string; unitId?: string; policy: 'direct' | 'single' | 'multi'; approvalsRequired?: number }) {
    await this.assertManage();
    const tenantId = requestContext.get().tenant!.id;
    const [c] = await this.db.run((tx) => tx.insert(newsChannels).values({ tenantId, ...input, approvalsRequired: input.policy === 'multi' ? (input.approvalsRequired ?? 2) : 1 }).returning());
    await this.audit.record({ action: 'news.channel.created', targetType: 'news_channel', targetId: c!.id, after: input });
    return c!;
  }

  async updateChannel(id: string, input: Partial<{ nameFa: string; description: string; policy: 'direct' | 'single' | 'multi'; approvalsRequired: number; active: boolean }>) {
    await this.assertManage();
    const [c] = await this.db.run((tx) => tx.update(newsChannels).set(input).where(eq(newsChannels.id, id)).returning());
    if (!c) throw new AppError('NOT_FOUND');
    await this.audit.record({ action: 'news.channel.updated', targetType: 'news_channel', targetId: id, after: input });
    return c;
  }

  async channelMembers(channelId: string) {
    await this.assertManage();
    return this.db.run((tx) =>
      tx
        .select({ membershipId: newsChannelMembers.membershipId, role: newsChannelMembers.role, fullName: users.fullName, kind: memberships.kind })
        .from(newsChannelMembers)
        .innerJoin(memberships, eq(memberships.id, newsChannelMembers.membershipId))
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(newsChannelMembers.channelId, channelId))
        .orderBy(asc(users.fullName)),
    );
  }

  /** NWS-04: grant a channel role to a person (a student may publish in this channel only). */
  async addChannelMember(channelId: string, membershipId: string, role: ChannelRole) {
    await this.assertManage();
    const tenantId = requestContext.get().tenant!.id;
    await this.db.run((tx) => tx.insert(newsChannelMembers).values({ tenantId, channelId, membershipId, role }).onConflictDoNothing());
    await this.audit.record({ action: 'news.channel.member_added', targetType: 'news_channel', targetId: channelId, after: { membershipId, role } });
  }

  async removeChannelMember(channelId: string, membershipId: string, role: ChannelRole) {
    await this.assertManage();
    await this.db.run((tx) =>
      tx.delete(newsChannelMembers).where(and(eq(newsChannelMembers.channelId, channelId), eq(newsChannelMembers.membershipId, membershipId), eq(newsChannelMembers.role, role))),
    );
    await this.audit.record({ action: 'news.channel.member_removed', targetType: 'news_channel', targetId: channelId, before: { membershipId, role } });
  }

  // ── posts: authoring ───────────────────────────────────────────────────

  private fields(input: Partial<PostInput>) {
    const audience = input.audience ? cleanAudience(input.audience) : undefined;
    if (audience && !Object.keys(audience).length) throw new AppError('VALIDATION_FAILED', { field: 'audience' });
    const body = input.bodyHtml !== undefined ? cleanHtml(input.bodyHtml) : undefined;
    return {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.summary !== undefined ? { summary: input.summary.trim() || null } : {}),
      ...(body !== undefined ? { bodyHtml: body } : {}),
      ...(input.coverFileId !== undefined ? { coverFileId: input.coverFileId } : {}),
      ...(input.attachmentFileIds ? { attachmentFileIds: [...new Set(input.attachmentFileIds)].slice(0, 10) } : {}),
      ...(input.category !== undefined ? { category: input.category.trim() || null } : {}),
      ...(input.tags ? { tags: [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))].slice(0, 10) } : {}),
      ...(input.source !== undefined ? { source: input.source.trim() || null } : {}),
      ...(audience ? { audience } : {}),
      ...(input.expireAt !== undefined ? { expireAt: input.expireAt ? new Date(input.expireAt) : null } : {}),
    };
  }

  /** Links the cover and attachment uploads of the author to the post. */
  private async linkFiles(tx: Executor, p: PostRow, ids: string[]) {
    const fresh = ids.filter(Boolean);
    if (!fresh.length) return;
    const rows = await tx.select().from(fileObjects).where(inArray(fileObjects.id, fresh));
    const unlinked = rows.filter((f) => !f.linkedId).map((f) => f.id);
    if (rows.some((f) => f.linkedId && f.linkedId !== p.id)) throw new AppError('VALIDATION_FAILED', { field: 'attachmentFileIds' });
    if (unlinked.length) await this.files.link(unlinked, 'news', p.id, { userId: requestContext.get().userId });
  }

  private async snapshot(tx: Executor, p: PostRow) {
    const { lockVersion: _l, updatedAt: _u, ...data } = p;
    await tx.insert(newsPostVersions).values({ tenantId: p.tenantId, postId: p.id, version: p.version, snapshot: data as Record<string, unknown>, createdBy: requestContext.get().userId }).onConflictDoNothing();
  }

  async create(input: PostInput) {
    const me = this.me();
    return this.db.run(async (tx) => {
      const [channel] = await tx.select().from(newsChannels).where(and(eq(newsChannels.id, input.channelId), eq(newsChannels.active, true))).limit(1);
      if (!channel) throw new AppError('VALIDATION_FAILED', { field: 'channelId' });
      await this.need(tx, channel.id, 'author', 'publisher');
      const f = this.fields(input);
      const [p] = await tx
        .insert(newsPosts)
        .values({ tenantId: me.tenantId, channelId: channel.id, slug: slugify(input.title), authorMembershipId: me.membershipId, title: f.title!, audience: f.audience!, ...f })
        .returning();
      await this.linkFiles(tx, p!, [p!.coverFileId ?? '', ...p!.attachmentFileIds]);
      await this.snapshot(tx, p!);
      await this.event(tx, p!, 'created');
      return p!;
    });
  }

  /** Drafts are edited by their author or a publisher; live posts only by a publisher (new version, NWS-11). */
  async update(id: string, input: Partial<PostInput>) {
    const me = this.me();
    return this.db.run(async (tx) => {
      const p = await this.load(tx, id);
      const roles = await this.rolesIn(tx, p.channelId);
      const live = ['approved', 'scheduled', 'published'].includes(p.status);
      if (live ? !roles.has('publisher') : !(roles.has('publisher') || (roles.has('author') && p.authorMembershipId === me.membershipId))) throw new AppError('FORBIDDEN');
      if (!['draft', 'approved', 'scheduled', 'published'].includes(p.status)) throw new AppError('INVALID_STATE_TRANSITION');
      if (input.channelId && input.channelId !== p.channelId) throw new AppError('VALIDATION_FAILED', { field: 'channelId' });
      await this.lock(tx, p);
      const [u] = await tx.update(newsPosts).set({ ...this.fields(input), version: p.version + 1, updatedAt: new Date() }).where(eq(newsPosts.id, p.id)).returning();
      await this.linkFiles(tx, u!, [u!.coverFileId ?? '', ...u!.attachmentFileIds]);
      await this.snapshot(tx, u!);
      await this.event(tx, u!, 'edited');
      return u!;
    });
  }

  /** NWS-05/06: to approval (or straight to approved when the channel needs none). */
  async submit(id: string) {
    const me = this.me();
    return this.db.run(async (tx) => {
      const p = await this.load(tx, id);
      const roles = await this.need(tx, p.channelId, 'author', 'publisher');
      if (p.authorMembershipId !== me.membershipId && !roles.has('publisher')) throw new AppError('FORBIDDEN');
      await this.lock(tx, p, ['draft']);
      const [channel] = await tx.select().from(newsChannels).where(eq(newsChannels.id, p.channelId));
      const status: NewsStatus = channel!.policy === 'direct' ? 'approved' : 'pending_approval';
      const [u] = await tx.update(newsPosts).set({ status }).where(eq(newsPosts.id, p.id)).returning();
      await this.event(tx, u!, status === 'approved' ? 'approved.auto' : 'submitted');
      if (status === 'pending_approval') await this.outbox.emit('news.submitted', { postId: p.id }, `news.submitted:${p.id}:${p.version}`);
      return u!;
    });
  }

  /** Approvers other than the author; the post is approved once enough distinct approvals arrive. */
  async approve(id: string, note?: string) {
    const me = this.me();
    return this.db.run(async (tx) => {
      const p = await this.load(tx, id);
      await this.need(tx, p.channelId, 'approver');
      if (p.authorMembershipId === me.membershipId) throw new AppError('SEPARATION_OF_DUTIES');
      if (p.status !== 'pending_approval') throw new AppError('INVALID_STATE_TRANSITION');
      const inserted = await tx
        .insert(newsApprovals)
        .values({ tenantId: p.tenantId, postId: p.id, version: p.version, approverMembershipId: me.membershipId, decision: 'approve', note: note ?? null })
        .onConflictDoNothing()
        .returning({ id: newsApprovals.id });
      if (!inserted.length) throw new AppError('CONFLICT', { reason: 'already_approved' });
      const [channel] = await tx.select().from(newsChannels).where(eq(newsChannels.id, p.channelId));
      const [{ n }] = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(newsApprovals)
        .where(and(eq(newsApprovals.postId, p.id), eq(newsApprovals.version, p.version), eq(newsApprovals.decision, 'approve')))) as [{ n: number }];
      await this.event(tx, p, 'approval', note);
      if (n >= (channel!.policy === 'multi' ? channel!.approvalsRequired : 1)) {
        await this.lock(tx, p, ['pending_approval']);
        const [u] = await tx.update(newsPosts).set({ status: 'approved' }).where(eq(newsPosts.id, p.id)).returning();
        await this.event(tx, u!, 'approved');
        return u!;
      }
      return p;
    });
  }

  async returnForFix(id: string, note: string) {
    const me = this.me();
    return this.db.run(async (tx) => {
      const p = await this.load(tx, id);
      await this.need(tx, p.channelId, 'approver', 'publisher');
      await this.lock(tx, p, ['pending_approval', 'approved']);
      await tx.insert(newsApprovals).values({ tenantId: p.tenantId, postId: p.id, version: p.version, approverMembershipId: me.membershipId, decision: 'return', note });
      const [u] = await tx.update(newsPosts).set({ status: 'draft' }).where(eq(newsPosts.id, p.id)).returning();
      await this.event(tx, u!, 'returned', note);
      await this.outbox.emit('news.returned', { postId: p.id }, `news.returned:${p.id}:${p.version}:${Date.now()}`);
      return u!;
    });
  }

  /** NWS-07: publish now or schedule (`publishAt` in the future); optional audience notification (NWS-13). */
  async publish(id: string, input: { publishAt?: string; expireAt?: string | null; notify?: boolean }) {
    return this.db.run(async (tx) => {
      const p = await this.load(tx, id);
      await this.need(tx, p.channelId, 'publisher');
      const [channel] = await tx.select().from(newsChannels).where(eq(newsChannels.id, p.channelId));
      // a publisher may publish a draft directly only in a direct-policy channel
      const allowed: NewsStatus[] = channel!.policy === 'direct' ? ['draft', 'approved'] : ['approved'];
      await this.lock(tx, p, allowed);
      const now = new Date();
      const at = input.publishAt ? new Date(input.publishAt) : now;
      const expireAt = input.expireAt === undefined ? p.expireAt : input.expireAt ? new Date(input.expireAt) : null;
      if (expireAt && expireAt <= at) throw new AppError('VALIDATION_FAILED', { field: 'expireAt' });
      const scheduled = at.getTime() > now.getTime() + 30_000;
      const [u] = await tx
        .update(newsPosts)
        .set({ status: scheduled ? 'scheduled' : 'published', publishAt: at, publishedAt: scheduled ? null : now, expireAt, notifyAudience: !!input.notify, unpublishReason: null, archivedAt: null })
        .where(eq(newsPosts.id, p.id))
        .returning();
      await this.event(tx, u!, scheduled ? 'scheduled' : 'published');
      if (!scheduled) await this.announce(u!);
      return u!;
    });
  }

  private async announce(p: PostRow) {
    if (p.notifyAudience) await this.outbox.emit('news.published', { postId: p.id }, `news.published:${p.id}:${p.version}`);
  }

  /** NWS-12: immediate unpublish with its own permission and a reason. */
  async unpublish(id: string, reason: string) {
    if (!(await this.acl.has('news.unpublish'))) throw new AppError('FORBIDDEN', { permission: 'news.unpublish' });
    return this.db.run(async (tx) => {
      const p = await this.load(tx, id);
      await this.lock(tx, p, ['published', 'scheduled']);
      const [u] = await tx.update(newsPosts).set({ status: 'archived', archivedAt: new Date(), unpublishReason: reason }).where(eq(newsPosts.id, p.id)).returning();
      await this.event(tx, u!, 'unpublished', reason);
      await this.audit.record({ action: 'news.unpublished', targetType: 'news_post', targetId: p.id, reason });
      return u!;
    });
  }

  async archive(id: string) {
    return this.db.run(async (tx) => {
      const p = await this.load(tx, id);
      await this.need(tx, p.channelId, 'publisher');
      await this.lock(tx, p, ['published']);
      const [u] = await tx.update(newsPosts).set({ status: 'archived', archivedAt: new Date() }).where(eq(newsPosts.id, p.id)).returning();
      await this.event(tx, u!, 'archived');
      return u!;
    });
  }

  /** Back to draft for another round (archived data is never lost, NWS-07). */
  async restore(id: string) {
    return this.db.run(async (tx) => {
      const p = await this.load(tx, id);
      await this.need(tx, p.channelId, 'publisher');
      await this.lock(tx, p, ['archived']);
      const [u] = await tx.update(newsPosts).set({ status: 'draft', archivedAt: null }).where(eq(newsPosts.id, p.id)).returning();
      await this.event(tx, u!, 'restored');
      return u!;
    });
  }

  async softDelete(id: string, reason: string) {
    return this.db.run(async (tx) => {
      const p = await this.load(tx, id);
      await this.need(tx, p.channelId, 'publisher');
      await this.lock(tx, p, ['draft', 'archived']);
      await tx.update(newsPosts).set({ status: 'deleted', deletedAt: new Date() }).where(eq(newsPosts.id, p.id));
      await this.event(tx, p, 'deleted', reason);
      await this.audit.record({ action: 'news.deleted', targetType: 'news_post', targetId: p.id, reason });
      return { id: p.id, status: 'deleted' };
    });
  }

  /** Minute sweep: scheduled → published at publish_at, published → archived at expire_at (NWS-07). */
  async sweep(now = new Date()) {
    const due = await this.db.sys
      .select({ id: newsPosts.id, tenantId: newsPosts.tenantId, status: newsPosts.status })
      .from(newsPosts)
      .where(sql`(${newsPosts.status} = 'scheduled' and ${newsPosts.publishAt} <= ${now}) or (${newsPosts.status} = 'published' and ${newsPosts.expireAt} <= ${now})`)
      .limit(200);
    for (const d of due) {
      await this.db.transaction({ tenantId: d.tenantId }, (tx) =>
        requestContext.run({ requestId: `news-sweep:${d.id}`, tenant: { id: d.tenantId, slug: '', status: 'active' }, tx }, async () => {
          const [u] = await tx
            .update(newsPosts)
            .set(d.status === 'scheduled' ? { status: 'published', publishedAt: now } : { status: 'archived', archivedAt: now })
            .where(and(eq(newsPosts.id, d.id), eq(newsPosts.status, d.status)))
            .returning();
          if (!u) return;
          await this.event(tx, u, d.status === 'scheduled' ? 'published.scheduled' : 'archived.expired');
          if (d.status === 'scheduled') await this.announce(u);
        }),
      );
    }
    return due.length;
  }

  // ── reading (NWS-10) ───────────────────────────────────────────────────

  private async viewer(tx: Executor): Promise<Viewer> {
    const ctx = requestContext.find();
    return loadViewer(tx, ctx?.membershipId, ctx?.membershipStatus === 'active');
  }

  /** The post if the caller may see it now; null otherwise (the caller reports "not found"). */
  async visible(tx: Executor, postId: string) {
    const v = await this.viewer(tx);
    const [p] = await tx
      .select()
      .from(newsPosts)
      .where(and(eq(newsPosts.id, postId), eq(newsPosts.status, 'published'), audienceMatch(sql`${newsPosts.audience}`, v)))
      .limit(1);
    return p ?? null;
  }

  async feed(q: { q?: string; category?: string; channelId?: string; tag?: string; limit: number; offset: number }) {
    return this.db.run(async (tx) => {
      const v = await this.viewer(tx);
      const where = and(
        eq(newsPosts.status, 'published'),
        audienceMatch(sql`${newsPosts.audience}`, v),
        q.q ? sql`(${newsPosts.title} ilike ${'%' + q.q + '%'} or ${newsPosts.summary} ilike ${'%' + q.q + '%'})` : undefined,
        q.category ? eq(newsPosts.category, q.category) : undefined,
        q.channelId ? eq(newsPosts.channelId, q.channelId) : undefined,
        q.tag ? sql`${q.tag} = any(${newsPosts.tags})` : undefined,
      );
      const items = await tx
        .select({
          id: newsPosts.id,
          slug: newsPosts.slug,
          title: newsPosts.title,
          summary: newsPosts.summary,
          category: newsPosts.category,
          tags: newsPosts.tags,
          coverFileId: newsPosts.coverFileId,
          publishedAt: newsPosts.publishedAt,
          channelName: newsChannels.nameFa,
          isPublic: sql<boolean>`coalesce((${newsPosts.audience}->>'public')::boolean, false)`,
        })
        .from(newsPosts)
        .innerJoin(newsChannels, eq(newsChannels.id, newsPosts.channelId))
        .where(where)
        .orderBy(desc(newsPosts.publishedAt))
        .limit(q.limit)
        .offset(q.offset);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(newsPosts).where(where)) as [{ n: number }];
      return { items, total: n };
    });
  }

  async detail(slug: string) {
    return this.db.run(async (tx) => {
      const v = await this.viewer(tx);
      const [p] = await tx
        .select({ post: newsPosts, channelName: newsChannels.nameFa, author: users.fullName })
        .from(newsPosts)
        .innerJoin(newsChannels, eq(newsChannels.id, newsPosts.channelId))
        .innerJoin(memberships, eq(memberships.id, newsPosts.authorMembershipId))
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(newsPosts.slug, slug), eq(newsPosts.status, 'published'), audienceMatch(sql`${newsPosts.audience}`, v)))
        .limit(1);
      if (!p) throw new AppError('NOT_FOUND');
      const files = p.post.attachmentFileIds.length
        ? await tx
            .select({ id: fileObjects.id, originalName: fileObjects.originalName, mimeType: fileObjects.mimeType, sizeBytes: fileObjects.sizeBytes, scanStatus: fileObjects.scanStatus })
            .from(fileObjects)
            .where(inArray(fileObjects.id, p.post.attachmentFileIds))
        : [];
      const x = p.post;
      return {
        id: x.id,
        slug: x.slug,
        title: x.title,
        summary: x.summary ?? plainText(x.bodyHtml).slice(0, 200),
        bodyHtml: x.bodyHtml,
        category: x.category,
        tags: x.tags,
        source: x.source,
        coverFileId: x.coverFileId,
        attachments: files,
        publishedAt: x.publishedAt,
        channelName: p.channelName,
        author: p.author,
        isPublic: !!x.audience.public,
      };
    });
  }

  /**
   * File of a public post for anonymous visitors (NWS-09). Addressed by tenant slug in the path so
   * plain <img> tags work without headers; restricted posts never resolve here.
   */
  async publicFile(tenantSlug: string, slug: string, fileId: string) {
    const db = this.db.sys;
    const [t] = await db.select({ id: tenants.id, status: tenants.status }).from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
    if (!t || t.status !== 'active') throw new AppError('NOT_FOUND');
    const [p] = await db
      .select()
      .from(newsPosts)
      .where(and(eq(newsPosts.tenantId, t.id), eq(newsPosts.slug, slug), eq(newsPosts.status, 'published'), sql`coalesce((${newsPosts.audience}->>'public')::boolean, false)`))
      .limit(1);
    if (!p || (p.coverFileId !== fileId && !p.attachmentFileIds.includes(fileId))) throw new AppError('NOT_FOUND');
    const [f] = await db.select().from(fileObjects).where(and(eq(fileObjects.id, fileId), eq(fileObjects.tenantId, t.id))).limit(1);
    if (!f || f.deletedAt || f.isConfidential || (f.scanStatus !== 'clean' && f.scanStatus !== 'skipped')) throw new AppError('NOT_FOUND');
    return f;
  }

  // ── management lists ───────────────────────────────────────────────────

  async manageList(q: { status?: NewsStatus; channelId?: string; limit: number; offset: number }) {
    const me = this.me();
    return this.db.run(async (tx) => {
      const manage = await this.acl.hasAnywhere('news.manage');
      const tenantWide = (await this.acl.has('news.create')) || (await this.acl.has('news.approve')) || (await this.acl.has('news.publish'));
      const scope =
        manage || tenantWide
          ? sql`true`
          : sql`${newsPosts.channelId} in (select channel_id from news_channel_members where membership_id = ${me.membershipId})`;
      const where = and(
        scope,
        sql`${newsPosts.status} <> 'deleted'`,
        q.status ? eq(newsPosts.status, q.status) : undefined,
        q.channelId ? eq(newsPosts.channelId, q.channelId) : undefined,
      );
      const items = await tx
        .select({
          id: newsPosts.id,
          title: newsPosts.title,
          slug: newsPosts.slug,
          status: newsPosts.status,
          channelName: newsChannels.nameFa,
          authorName: users.fullName,
          publishAt: newsPosts.publishAt,
          publishedAt: newsPosts.publishedAt,
          expireAt: newsPosts.expireAt,
          updatedAt: newsPosts.updatedAt,
          audience: newsPosts.audience,
        })
        .from(newsPosts)
        .innerJoin(newsChannels, eq(newsChannels.id, newsPosts.channelId))
        .innerJoin(memberships, eq(memberships.id, newsPosts.authorMembershipId))
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(where)
        .orderBy(desc(newsPosts.updatedAt))
        .limit(q.limit)
        .offset(q.offset);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(newsPosts).where(where)) as [{ n: number }];
      return { items, total: n };
    });
  }

  /** Editor view: the post, versions, approvals and history (channel roles required). */
  async manageGet(id: string) {
    return this.db.run(async (tx) => {
      const p = await this.load(tx, id);
      const roles = await this.rolesIn(tx, p.channelId);
      if (!roles.size && !(await this.acl.hasAnywhere('news.manage'))) throw new AppError('NOT_FOUND');
      const [channel] = await tx.select().from(newsChannels).where(eq(newsChannels.id, p.channelId));
      const versions = await tx.select({ version: newsPostVersions.version, createdAt: newsPostVersions.createdAt }).from(newsPostVersions).where(eq(newsPostVersions.postId, p.id)).orderBy(desc(newsPostVersions.version));
      const approvals = await tx
        .select({ version: newsApprovals.version, decision: newsApprovals.decision, note: newsApprovals.note, createdAt: newsApprovals.createdAt, approver: users.fullName, approverMembershipId: newsApprovals.approverMembershipId })
        .from(newsApprovals)
        .innerJoin(memberships, eq(memberships.id, newsApprovals.approverMembershipId))
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(newsApprovals.postId, p.id))
        .orderBy(desc(newsApprovals.createdAt));
      const history = await tx
        .select({ type: newsEvents.type, version: newsEvents.version, note: newsEvents.note, occurredAt: newsEvents.occurredAt, actor: users.fullName })
        .from(newsEvents)
        .leftJoin(users, eq(users.id, newsEvents.actorUserId))
        .where(eq(newsEvents.postId, p.id))
        .orderBy(asc(newsEvents.occurredAt));
      const fileIds = [p.coverFileId, ...p.attachmentFileIds].filter((x): x is string => !!x);
      const files = fileIds.length
        ? await tx.select({ id: fileObjects.id, originalName: fileObjects.originalName, mimeType: fileObjects.mimeType, sizeBytes: fileObjects.sizeBytes, scanStatus: fileObjects.scanStatus }).from(fileObjects).where(inArray(fileObjects.id, fileIds))
        : [];
      const { lockVersion, ...post } = p;
      return {
        ...post,
        lockVersion,
        channel: { id: channel!.id, nameFa: channel!.nameFa, policy: channel!.policy, approvalsRequired: channel!.approvalsRequired },
        myRoles: [...roles],
        isAuthor: p.authorMembershipId === requestContext.get().membershipId,
        canUnpublish: await this.acl.has('news.unpublish'),
        files,
        versions,
        approvals,
        history,
      };
    });
  }

  async version(id: string, version: number) {
    return this.db.run(async (tx) => {
      const p = await this.load(tx, id);
      if (!(await this.rolesIn(tx, p.channelId)).size) throw new AppError('NOT_FOUND');
      const [v] = await tx.select().from(newsPostVersions).where(and(eq(newsPostVersions.postId, id), eq(newsPostVersions.version, version))).limit(1);
      if (!v) throw new AppError('NOT_FOUND');
      return v;
    });
  }
}
