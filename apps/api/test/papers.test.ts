import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  createPlatformAdmin,
  createTenant,
  createUnit,
  login,
  nextMobile,
  registerStudent,
  setPasswordViaReset,
  startApp,
  sysPool,
  toE164,
  type TenantFixture,
  type TestApp,
} from './helpers.js';

interface Person {
  token: string;
  membershipId: string;
  userId: string;
  mobile: string;
  fullName: string;
}

const AUTHOR_NAME = 'سارا احمدی‌نژاد';

describe('papers and peer review (phase 4, PAP-01..14)', () => {
  let t: TestApp;
  let tf: TenantFixture;
  let roles: { id: string; key: string }[];
  let manager: Person;
  let r1: Person; // same faculty as the author → conflict warning
  let r2: Person; // other faculty
  let r3: Person; // listed as co-author → hard block
  let author: Person;
  let eng = '';
  let sci = '';
  let track = '';
  const pool = sysPool();
  const admin = () => as(tf.adminToken, tf.slug);

  async function person(fullName: string, unitId: string, role: string): Promise<Person> {
    const mobile = nextMobile();
    const inv = await t.http.post('/v1/admin/memberships/invite').set(admin()).send({ kind: 'staff', fullName, mobile, unitId }).expect(201);
    await t.http.post('/v1/admin/role-assignments').set(admin()).send({ membershipId: inv.body.membershipId, roleId: roles.find((r) => r.key === role)!.id, scopeType: 'tenant' }).expect(201);
    await setPasswordViaReset(t, mobile, 'Person#Pass123');
    const userId = (await pool.query('select user_id from memberships where id = $1', [inv.body.membershipId])).rows[0].user_id;
    return { token: await login(t, mobile, 'Person#Pass123'), membershipId: inv.body.membershipId, userId, mobile, fullName };
  }

  async function manuscript(token: string, authorMeta = AUTHOR_NAME) {
    const doc = await PDFDocument.create();
    doc.addPage().drawText('Deep learning for low-power devices');
    doc.setAuthor(authorMeta);
    doc.setCreator(`Word — ${authorMeta}`);
    const buf = Buffer.from(await doc.save());
    const r = await t.http.post('/v1/files').set(as(token, tf.slug)).field('purpose', 'paper_manuscript').attach('file', buf, `${authorMeta}.pdf`).expect(201);
    return r.body.id as string;
  }

  async function newPaper(extra: Record<string, unknown> = {}, trackId = track) {
    const d = await t.http
      .post('/v1/papers')
      .set(as(author.token, tf.slug))
      .send({ trackId, title: 'یادگیری عمیق کم‌مصرف', abstract: 'چکیده', keywords: ['شبکه عصبی'], degree: 'msc', ...extra })
      .expect(201);
    const fileId = await manuscript(author.token);
    const s = await t.http.post(`/v1/papers/${d.body.id}/submit`).set(as(author.token, tf.slug)).send({ manuscriptFileId: fileId }).expect(200);
    return s.body as { id: string; trackingCode: string; status: string };
  }

  const mgr = (path: string) => t.http.post(`/v1/admin/papers/${path}`).set(as(manager.token, tf.slug));

  beforeAll(async () => {
    t = await startApp();
    const platform = await createPlatformAdmin(t);
    tf = await createTenant(t, platform.token);
    eng = (await createUnit(t, tf, 'دانشکده مهندسی')).id;
    sci = (await createUnit(t, tf, 'دانشکده علوم')).id;
    roles = (await t.http.get('/v1/admin/roles').set(admin())).body;
    manager = await person('مدیر بررسی', eng, 'review_manager');
    r1 = await person('داور هم‌دانشکده', eng, 'reviewer');
    r2 = await person('داور علوم پایه', sci, 'reviewer');
    r3 = await person('داور هم‌نویسنده', sci, 'reviewer');
    const s = await registerStudent(t, tf, eng);
    await pool.query(`update users set full_name = $1 where id = $2`, [AUTHOR_NAME, s.userId]);
    await t.http.post(`/v1/admin/memberships/${s.membershipId}/approve`).set(admin()).send({}).expect(200);
    author = { token: await login(t, s.mobile, s.password), membershipId: s.membershipId, userId: s.userId, mobile: s.mobile, fullName: AUTHOR_NAME };
    const tr = await t.http.post('/v1/admin/paper-tracks').set(as(manager.token, tf.slug)).send({ nameFa: 'داوری دوسوکور', reviewMode: 'double_blind', maxRounds: 2, reviewerDays: 10 }).expect(201);
    track = tr.body.id;
  });
  afterAll(async () => {
    await pool.end();
    await t.close();
  });

  let paperId = '';
  let guestSession = '';
  const leaks: { where: string; body: string }[] = [];
  const collect = (where: string, body: unknown) => leaks.push({ where, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('submission issues a tracking code, locks the review mode and scrubs the manuscript (PAP-01/09/10)', async () => {
    const p = await newPaper({ coAuthors: [{ fullName: 'هم‌نویسنده', membershipId: r3.membershipId }] });
    paperId = p.id;
    expect(p.status).toBe('submitted');
    expect(p.trackingCode).toMatch(/^P-14\d\d-\d{6}$/);
    // later changes to the track do not affect this paper
    await t.http.patch(`/v1/admin/paper-tracks/${track}`).set(as(manager.token, tf.slug)).send({ reviewMode: 'open' }).expect(200);
    const mv = await t.http.get(`/v1/admin/papers/${paperId}`).set(as(manager.token, tf.slug)).expect(200);
    expect(mv.body.reviewMode).toBe('double_blind');
    expect(mv.body.versions[0].reviewCopy.originalName).toBe('manuscript-r1.pdf');
    expect(mv.body.versions[0].scrubReport.cleared).toEqual(expect.arrayContaining(['Author', 'Creator']));
    await t.http.patch(`/v1/admin/paper-tracks/${track}`).set(as(manager.token, tf.slug)).send({ reviewMode: 'double_blind' }).expect(200);
    // reviewers and authors cannot open the manager view
    await t.http.get(`/v1/admin/papers/${paperId}`).set(as(author.token, tf.slug)).expect(404);
    await t.http.get(`/v1/admin/papers/${paperId}`).set(as(r2.token, tf.slug)).expect(404);
  });

  it('screening and reviewer assignment with conflict-of-interest checks (PAP-02/03/04)', async () => {
    await mgr(`${paperId}/screen`).send({ decision: 'send_to_review' }).expect(200);
    const cands = await t.http.get(`/v1/admin/papers/${paperId}/reviewer-candidates`).set(as(manager.token, tf.slug)).expect(200);
    const of = (m: string) => cands.body.find((c: { membership_id: string }) => c.membership_id === m).conflicts;
    expect(of(r1.membershipId)).toContain('same_unit');
    expect(of(r3.membershipId)).toContain('co_author');
    expect(of(r2.membershipId)).toEqual([]);

    await mgr(`${paperId}/reviewers`).send({ reviewers: [{ membershipId: r3.membershipId }] }).expect(403);
    const coi = await mgr(`${paperId}/reviewers`).send({ reviewers: [{ membershipId: r1.membershipId }, { membershipId: r2.membershipId }] }).expect(409);
    expect(coi.body.error.code).toBe('CONFLICT_OF_INTEREST');
    await mgr(`${paperId}/reviewers`).send({ reviewers: [{ membershipId: r1.membershipId }, { membershipId: r2.membershipId, dueDays: 5 }], acknowledgeConflicts: true }).expect(200);
  });

  it('member reviewers: decline, accept, read the scrubbed copy only, submit (PAP-05/14)', async () => {
    const mineR1 = (await t.http.get('/v1/me/reviews').set(as(r1.token, tf.slug)).expect(200)).body;
    await t.http.post(`/v1/reviews/${mineR1[0].id}/decline`).set(as(r1.token, tf.slug)).send({ reason: 'وقت ندارم' }).expect(200);

    const list = (await t.http.get('/v1/me/reviews').set(as(r2.token, tf.slug)).expect(200)).body;
    collect('r2 list', list);
    const reviewId = list[0].id;
    // r1 cannot see r2's review
    await t.http.get(`/v1/reviews/${reviewId}`).set(as(r1.token, tf.slug)).expect(404);
    const before = await t.http.get(`/v1/reviews/${reviewId}`).set(as(r2.token, tf.slug)).expect(200);
    expect(before.body.manuscript).toBeNull(); // only after accepting
    const acc = await t.http.post(`/v1/reviews/${reviewId}/accept`).set(as(r2.token, tf.slug)).expect(200);
    collect('r2 review view', acc.body);
    expect(acc.body.paper.author).toBeNull();
    expect(acc.body.manuscript.name).toBe('manuscript-r1.pdf');

    const link = await t.http.post(`/v1/files/${acc.body.manuscript.fileId}/download-link`).set(as(r2.token, tf.slug)).expect(201);
    const pdf = await t.http.get(link.body.url).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    collect('r2 manuscript bytes', (pdf.body as Buffer).toString('latin1'));
    expect(pdf.headers['content-disposition']).toContain('manuscript-r1.pdf');
    // the author's original upload is out of reach
    const mv = await t.http.get(`/v1/admin/papers/${paperId}`).set(as(manager.token, tf.slug));
    await t.http.post(`/v1/files/${mv.body.versions[0].original.id}/download-link`).set(as(r2.token, tf.slug)).expect(404);

    await t.http
      .post(`/v1/reviews/${reviewId}/submit`)
      .set(as(r2.token, tf.slug))
      .send({ recommendation: 'major_revision', commentsToAuthor: 'روش ارزیابی باید کامل‌تر شود.', confidentialComments: 'به نظرم ضعیف است', scores: { novelty: 6 } })
      .expect(200);
  });

  it('guest reviewer: one-time link, scoped session, scrubbed manuscript, revocation (PAP-11)', async () => {
    const guestMobile = nextMobile();
    const inv = await mgr(`${paperId}/guest-reviewers`).send({ fullName: 'داور مهمان بیرونی', mobile: guestMobile, dueDays: 7 }).expect(201);
    const sms = t.sms.lastTo(toE164(guestMobile))!.text;
    expect(sms).not.toContain(AUTHOR_NAME);
    const token = sms.match(/\/review\/([A-Za-z0-9_-]+)/)![1]!;
    expect(inv.body.inviteUrl).toContain(token);

    const s = await t.http.post('/v1/guest/sessions').send({ token }).expect(200);
    guestSession = s.body.sessionToken;
    await t.http.post('/v1/guest/sessions').send({ token }).expect(403); // one-time
    const view = await t.http.get('/v1/guest/review').set({ 'x-guest-token': guestSession }).expect(200);
    collect('guest view', view.body);
    expect(view.body.paper.author).toBeNull();
    await t.http.post('/v1/guest/review/accept').set({ 'x-guest-token': guestSession }).expect(200);
    const file = await t.http.get('/v1/guest/review/manuscript').set({ 'x-guest-token': guestSession }).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    collect('guest manuscript bytes', (file.body as Buffer).toString('latin1'));
    // a guest session reaches nothing else
    await t.http.get(`/v1/admin/papers/${paperId}`).set({ 'x-guest-token': guestSession, 'x-tenant': tf.slug }).expect(401);
    await t.http
      .post('/v1/guest/review/submit')
      .set({ 'x-guest-token': guestSession })
      .send({ recommendation: 'minor_revision', commentsToAuthor: 'جدول ۲ نیاز به توضیح دارد.' })
      .expect(200);

    const mv = await t.http.get(`/v1/admin/papers/${paperId}`).set(as(manager.token, tf.slug)).expect(200);
    expect(mv.body.status).toBe('reviews_done');
    const guestReview = mv.body.reviews.find((r: { reviewer: { type: string } }) => r.reviewer.type === 'guest');
    expect(guestReview.reviewer.fullName).toBe('داور مهمان بیرونی');
    // revoked guests are locked out immediately
    await t.http.post(`/v1/admin/paper-guests/${guestReview.reviewer.guestId}/revoke`).set(as(manager.token, tf.slug)).send({ reason: 'پایان داوری' }).expect(200);
    await t.http.get('/v1/guest/review').set({ 'x-guest-token': guestSession }).expect(403);
  });

  it('decision with revision; author sees reviews by alias only; next round keeps aliases (PAP-06/07/08)', async () => {
    const authorBefore = await t.http.get(`/v1/papers/${paperId}`).set(as(author.token, tf.slug)).expect(200);
    expect(authorBefore.body.reviews).toEqual([]); // nothing before the decision
    await t.http.post(`/v1/admin/papers/${paperId}/decision`).set(as(manager.token, tf.slug)).send({ decision: 'major_revision', note: 'لطفاً نظرات را اعمال کنید', revisionDays: 20 }).expect(200);
    const av = await t.http.get(`/v1/papers/${paperId}`).set(as(author.token, tf.slug)).expect(200);
    collect('author view', av.body);
    expect(av.body.status).toBe('revision_requested');
    expect(av.body.reviews.map((r: { reviewer: string }) => r.reviewer).sort()).toEqual(['داور ۲', 'داور ۳']);
    expect(JSON.stringify(av.body)).not.toContain('به نظرم ضعیف است'); // confidential text stays with the manager

    const v2 = await manuscript(author.token);
    await t.http.post(`/v1/papers/${paperId}/revision`).set(as(author.token, tf.slug)).send({ manuscriptFileId: v2, responseLetter: 'روش ارزیابی گسترش یافت.' }).expect(200);
    await mgr(`${paperId}/reviewers`).send({ reviewers: [{ membershipId: r2.membershipId }] }).expect(200);
    const r2List = (await t.http.get('/v1/me/reviews').set(as(r2.token, tf.slug))).body;
    const round2 = r2List.find((x: { round: number }) => x.round === 2);
    expect(round2.alias_no).toBe(2);
    await t.http.post(`/v1/reviews/${round2.id}/accept`).set(as(r2.token, tf.slug)).expect(200);
    const rv = await t.http.get(`/v1/reviews/${round2.id}`).set(as(r2.token, tf.slug)).expect(200);
    collect('r2 round 2 view', rv.body);
    expect(rv.body.responseLetter).toBe('روش ارزیابی گسترش یافت.');
    expect(rv.body.previousRounds).toHaveLength(1);
    await t.http.post(`/v1/reviews/${round2.id}/submit`).set(as(r2.token, tf.slug)).send({ recommendation: 'accept', commentsToAuthor: 'اصلاحات کافی است.' }).expect(200);
    // the track allows two rounds: no third
    const max = await t.http.post(`/v1/admin/papers/${paperId}/decision`).set(as(manager.token, tf.slug)).send({ decision: 'minor_revision' }).expect(409);
    expect(max.body.error.code).toBe('MAX_ROUNDS_REACHED');
    await t.http.post(`/v1/admin/papers/${paperId}/decision`).set(as(manager.token, tf.slug)).send({ decision: 'accept', note: 'تبریک' }).expect(200);
    const final = await t.http.get(`/v1/papers/${paperId}`).set(as(author.token, tf.slug)).expect(200);
    collect('author final view', final.body);
    expect(final.body.status).toBe('accepted');
    expect(final.body.reviews).toHaveLength(3);
  });

  it('notifications carry no counterpart identity', async () => {
    await t.flush();
    const authorInbox = (await t.http.get('/v1/me/notifications?limit=50').set(as(author.token, tf.slug))).body;
    collect('author inbox', authorInbox);
    expect(authorInbox.items.map((n: { event: string }) => n.event)).toEqual(expect.arrayContaining(['paper.submitted', 'paper.revision_requested', 'paper.decided']));
    const r2Inbox = (await t.http.get('/v1/me/notifications?limit=50').set(as(r2.token, tf.slug))).body;
    collect('reviewer inbox', r2Inbox);
    expect(r2Inbox.items.map((n: { event: string }) => n.event)).toContain('paper.review.invited');
    collect('author sms', t.sms.sent.filter((m) => m.to === toE164(author.mobile)).map((m) => m.text));
    collect('reviewer sms', t.sms.sent.filter((m) => m.to === toE164(r2.mobile)).map((m) => m.text));
  });

  it('GATE: no identity leaks across the double-blind boundary', async () => {
    const authorMarkers = [AUTHOR_NAME, author.membershipId, author.userId, author.mobile.slice(1), 'احمدی‌نژاد'];
    const reviewerMarkers = [r1.fullName, r2.fullName, 'داور مهمان بیرونی', r1.membershipId, r2.membershipId, r1.userId, r2.userId, r2.mobile.slice(1)];
    const reviewerSide = leaks.filter((l) => /^(r2|guest|reviewer)/.test(l.where));
    const authorSide = leaks.filter((l) => /^author/.test(l.where));
    expect(reviewerSide.length).toBeGreaterThan(5);
    expect(authorSide.length).toBeGreaterThan(3);
    for (const l of reviewerSide) for (const m of authorMarkers) expect(l.body.includes(m), `${l.where} leaks ${m}`).toBe(false);
    for (const l of authorSide) for (const m of reviewerMarkers) expect(l.body.includes(m), `${l.where} leaks ${m}`).toBe(false);
  });

  it('withdrawal releases active reviewers and tells them (PAP-13)', async () => {
    const p = await newPaper();
    await mgr(`${p.id}/screen`).send({ decision: 'send_to_review' }).expect(200);
    await mgr(`${p.id}/reviewers`).send({ reviewers: [{ membershipId: r2.membershipId }] }).expect(200);
    await t.http.post(`/v1/papers/${p.id}/withdraw`).set(as(author.token, tf.slug)).send({ reason: 'ارسال به مجله دیگر' }).expect(200);
    const mine = (await t.http.get('/v1/me/reviews').set(as(r2.token, tf.slug))).body;
    expect(mine.some((x: { tracking_code: string }) => x.tracking_code === p.trackingCode)).toBe(false); // cancelled ones are hidden
    await t.flush();
    const inbox = (await t.http.get('/v1/me/notifications?limit=50').set(as(r2.token, tf.slug))).body;
    expect(inbox.items.map((n: { event: string }) => n.event)).toContain('paper.withdrawn');
  });

  it('open review shows names; reminders reach reviewers before the deadline (PAP-09/12)', async () => {
    const open = await t.http.post('/v1/admin/paper-tracks').set(as(manager.token, tf.slug)).send({ nameFa: 'داوری آشکار', reviewMode: 'open', reviewerDays: 1 }).expect(201);
    const p = await newPaper({}, open.body.id);
    await mgr(`${p.id}/screen`).send({ decision: 'send_to_review' }).expect(200);
    await mgr(`${p.id}/reviewers`).send({ reviewers: [{ membershipId: r2.membershipId, dueDays: 1 }] }).expect(200);
    const rid = (await t.http.get('/v1/me/reviews').set(as(r2.token, tf.slug))).body.find((x: { tracking_code: string }) => x.tracking_code === p.trackingCode).id;
    const view = await t.http.post(`/v1/reviews/${rid}/accept`).set(as(r2.token, tf.slug)).expect(200);
    expect(view.body.paper.author.fullName).toBe(AUTHOR_NAME);
    const papers = t.app.get((await import('../src/modules/papers/papers.service.js')).PapersService);
    expect(await papers.remindReviewers()).toBeGreaterThan(0);
    await t.flush();
    const inbox = (await t.http.get('/v1/me/notifications?limit=50').set(as(r2.token, tf.slug))).body;
    expect(inbox.items.map((n: { event: string }) => n.event)).toContain('paper.review.reminder');
  });
});
