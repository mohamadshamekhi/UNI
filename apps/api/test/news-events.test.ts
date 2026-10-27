import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createPlatformAdmin, createTenant, createUnit, login, nextMobile, PNG, registerStudent, setPasswordViaReset, startApp, sysPool, type TenantFixture, type TestApp } from './helpers.js';

interface Person {
  token: string;
  membershipId: string;
  userId: string;
}

describe('news and events (phase 5, NWS-01..15, EVT-01..12)', () => {
  let t: TestApp;
  let tf: TenantFixture;
  let other: TenantFixture;
  let roles: { id: string; key: string }[];
  let eng = '';
  let cs = ''; // child of eng
  let sci = '';
  let author: Person; // channel author only
  let approver: Person;
  let editor: Person; // news_editor role (tenant-wide publish)
  let engStudent: Person; // in cs (under eng)
  let sciStudent: Person;
  let organiser: Person;
  let outsider: Person; // member of the other university
  let channel = '';
  const pool = sysPool();
  const admin = () => as(tf.adminToken, tf.slug);

  async function staff(target: TenantFixture, unitId: string, role?: string): Promise<Person> {
    const mobile = nextMobile();
    const inv = await t.http.post('/v1/admin/memberships/invite').set(as(target.adminToken, target.slug)).send({ kind: 'staff', fullName: 'کارمند', mobile, unitId }).expect(201);
    if (role) {
      const rs = target === tf ? roles : (await t.http.get('/v1/admin/roles').set(as(target.adminToken, target.slug))).body;
      await t.http.post('/v1/admin/role-assignments').set(as(target.adminToken, target.slug)).send({ membershipId: inv.body.membershipId, roleId: rs.find((r: { key: string }) => r.key === role)!.id, scopeType: 'tenant' }).expect(201);
    }
    await setPasswordViaReset(t, mobile, 'Person#Pass123');
    const userId = (await pool.query('select user_id from memberships where id = $1', [inv.body.membershipId])).rows[0].user_id;
    return { token: await login(t, mobile, 'Person#Pass123'), membershipId: inv.body.membershipId, userId };
  }

  async function student(unitId: string): Promise<Person> {
    const s = await registerStudent(t, tf, unitId);
    await t.http.post(`/v1/admin/memberships/${s.membershipId}/approve`).set(admin()).send({}).expect(200);
    return { token: await login(t, s.mobile, s.password), membershipId: s.membershipId, userId: s.userId };
  }

  const inbox = async (userId: string) => (await pool.query('select event, title, body from notifications where user_id = $1', [userId])).rows as { event: string; title: string; body: string }[];

  beforeAll(async () => {
    t = await startApp();
    const platform = await createPlatformAdmin(t);
    tf = await createTenant(t, platform.token);
    other = await createTenant(t, platform.token);
    roles = (await t.http.get('/v1/admin/roles').set(admin())).body;
    eng = (await createUnit(t, tf, 'دانشکده مهندسی')).id;
    cs = (await createUnit(t, tf, 'گروه کامپیوتر', eng)).id;
    sci = (await createUnit(t, tf, 'دانشکده علوم')).id;
    author = await staff(tf, eng);
    approver = await staff(tf, eng);
    editor = await staff(tf, sci, 'news_editor');
    organiser = await staff(tf, eng);
    engStudent = await student(cs);
    sciStudent = await student(sci);
    outsider = await staff(other, (await createUnit(t, other, 'دانشکده هنر')).id);
    await t.http.post('/v1/admin/role-assignments').set(admin()).send({ membershipId: organiser.membershipId, roleId: roles.find((r) => r.key === 'event_manager')!.id, scopeType: 'unit_tree', scopeId: eng }).expect(201);
  });
  afterAll(async () => {
    await pool.end();
    await t.close();
  });

  describe('news', () => {
    let restricted = { id: '', slug: '' };
    let attachment = '';
    let cover = '';

    it('only news managers create channels; channel roles are per channel (NWS-03/04)', async () => {
      await t.http.post('/v1/admin/news-channels').set(as(author.token, tf.slug)).send({ nameFa: 'کانال', policy: 'single' }).expect(403);
      const c = await t.http.post('/v1/admin/news-channels').set(admin()).send({ nameFa: 'اخبار دانشکده مهندسی', unitId: eng, policy: 'single' }).expect(201);
      channel = c.body.id;
      await t.http.post(`/v1/admin/news-channels/${channel}/members`).set(admin()).send({ membershipId: author.membershipId, role: 'author' }).expect(201);
      await t.http.post(`/v1/admin/news-channels/${channel}/members`).set(admin()).send({ membershipId: approver.membershipId, role: 'approver' }).expect(201);
      // a plain member cannot write in the channel
      await t.http.post('/v1/admin/news').set(as(engStudent.token, tf.slug)).send({ channelId: channel, title: 'x', audience: { public: true } }).expect(403);
    });

    it('sanitises the body (NWS-08)', async () => {
      const r = await t.http
        .post('/v1/admin/news')
        .set(as(author.token, tf.slug))
        .send({ channelId: channel, title: 'خبر آزمایشی', bodyHtml: '<p onclick="x()">سلام<script>alert(1)</script><a href="javascript:alert(1)">لینک</a></p>', audience: { public: true } })
        .expect(201);
      expect(r.body.bodyHtml).not.toMatch(/script|onclick|javascript:/);
      expect(r.body.bodyHtml).toContain('سلام');
    });

    it('a restricted post goes through approval with separation of duties (NWS-05)', async () => {
      const up = (purpose: string) => t.http.post('/v1/files').set(as(author.token, tf.slug)).field('purpose', purpose).attach('file', PNG, 'a.png').expect(201);
      attachment = (await up('news_attachment')).body.id;
      cover = (await up('news_image')).body.id;
      const r = await t.http
        .post('/v1/admin/news')
        .set(as(author.token, tf.slug))
        .send({ channelId: channel, title: 'آزمون جامع دانشجویان مهندسی', summary: 'محرمانه', bodyHtml: '<p>زمان آزمون</p>', coverFileId: cover, attachmentFileIds: [attachment], audience: { units: [{ id: eng, tree: true }] } })
        .expect(201);
      restricted = { id: r.body.id, slug: r.body.slug };
      const s = await t.http.post(`/v1/admin/news/${restricted.id}/submit`).set(as(author.token, tf.slug)).expect(200);
      expect(s.body.status).toBe('pending_approval');
      // the author cannot approve or publish their own post
      await t.http.post(`/v1/admin/news/${restricted.id}/approve`).set(as(author.token, tf.slug)).send({}).expect(403);
      await t.http.post(`/v1/admin/news/${restricted.id}/publish`).set(as(author.token, tf.slug)).send({}).expect(403);
      await t.http.post(`/v1/admin/news/${restricted.id}/approve`).set(as(approver.token, tf.slug)).send({ note: 'خوب است' }).expect(200);
      const p = await t.http.post(`/v1/admin/news/${restricted.id}/publish`).set(as(editor.token, tf.slug)).send({ notify: true }).expect(200);
      expect(p.body.status).toBe('published');
      await t.flush();
    });

    it('GATE: a restricted post is invisible to everyone outside its audience — feed, search, link, files, notifications', async () => {
      const titleWord = 'آزمون جامع';
      // in the audience (member of a sub-unit, tree rule)
      const feedIn = await t.http.get('/v1/news').set(as(engStudent.token, tf.slug)).expect(200);
      expect(feedIn.body.items.map((x: { id: string }) => x.id)).toContain(restricted.id);
      await t.http.get(`/v1/news/${restricted.slug}`).set(as(engStudent.token, tf.slug)).expect(200);
      const link = await t.http.post(`/v1/files/${attachment}/download-link`).set(as(engStudent.token, tf.slug)).send({}).expect(201);
      expect(link.body.url ?? link.body.token).toBeTruthy();
      expect((await inbox(engStudent.userId)).some((n) => n.event === 'news.published')).toBe(true);

      const outsiders = [
        { who: 'other faculty member', h: as(sciStudent.token, tf.slug) },
        { who: 'other university', h: as(outsider.token, other.slug) },
        { who: 'anonymous', h: { 'x-tenant': tf.slug } },
      ];
      for (const o of outsiders) {
        const feed = await t.http.get('/v1/news').set(o.h).expect(200);
        expect(JSON.stringify(feed.body), o.who).not.toContain(restricted.id);
        const search = await t.http.get(`/v1/news?q=${encodeURIComponent(titleWord)}`).set(o.h).expect(200);
        expect(JSON.stringify(search.body), o.who).not.toContain(titleWord);
        const d = await t.http.get(`/v1/news/${restricted.slug}`).set(o.h);
        expect(d.status, o.who).toBe(404);
        expect(JSON.stringify(d.body)).not.toContain(titleWord);
        await t.http.get(`/v1/tenants/${tf.slug}/news/${encodeURIComponent(restricted.slug)}/files/${attachment}`).expect(404);
        await t.http.get(`/v1/tenants/${tf.slug}/news/${encodeURIComponent(restricted.slug)}/files/${cover}`).expect(404);
      }
      await t.http.post(`/v1/files/${attachment}/download-link`).set(as(sciStudent.token, tf.slug)).send({}).expect(404);
      expect((await inbox(sciStudent.userId)).some((n) => n.event === 'news.published')).toBe(false);
      expect((await inbox(outsider.userId)).length).toBe(0);
    });

    it('public posts are readable anonymously, with their files (NWS-09/14)', async () => {
      const img = (await t.http.post('/v1/files').set(as(editor.token, tf.slug)).field('purpose', 'news_image').attach('file', PNG, 'c.png').expect(201)).body.id;
      const ok = await t.http.post('/v1/admin/news').set(as(editor.token, tf.slug)).send({ channelId: channel, title: 'افتتاح کتابخانه مرکزی', coverFileId: img, audience: { public: true } }).expect(201);
      await t.http.post(`/v1/admin/news/${ok.body.id}/submit`).set(as(editor.token, tf.slug)).expect(200);
      await t.http.post(`/v1/admin/news/${ok.body.id}/approve`).set(as(approver.token, tf.slug)).send({}).expect(200);
      await t.http.post(`/v1/admin/news/${ok.body.id}/publish`).set(as(editor.token, tf.slug)).send({}).expect(200);
      const anon = await t.http.get(`/v1/news/${ok.body.slug}`).set({ 'x-tenant': tf.slug }).expect(200);
      expect(anon.body.title).toBe('افتتاح کتابخانه مرکزی');
      const f = await t.http.get(`/v1/tenants/${tf.slug}/news/${encodeURIComponent(ok.body.slug)}/files/${img}`).expect(200);
      expect(f.headers['content-type']).toBe('image/png');
    });

    it('scheduling publishes at publish_at and archives at expire_at (NWS-07)', async () => {
      const r = await t.http.post('/v1/admin/news').set(as(editor.token, tf.slug)).send({ channelId: channel, title: 'اطلاعیه زمان‌بندی‌شده', audience: { members: true } }).expect(201);
      await t.http.post(`/v1/admin/news/${r.body.id}/submit`).set(as(editor.token, tf.slug)).expect(200);
      await t.http.post(`/v1/admin/news/${r.body.id}/approve`).set(as(approver.token, tf.slug)).send({}).expect(200);
      const at = new Date(Date.now() + 3_600_000);
      const s = await t.http.post(`/v1/admin/news/${r.body.id}/publish`).set(as(editor.token, tf.slug)).send({ publishAt: at.toISOString(), expireAt: new Date(at.getTime() + 3_600_000).toISOString() }).expect(200);
      expect(s.body.status).toBe('scheduled');
      await t.http.get(`/v1/news/${r.body.slug}`).set(as(sciStudent.token, tf.slug)).expect(404);
      const news = t.app.get((await import('../src/modules/news/news.service.js')).NewsService);
      await news.sweep(new Date(at.getTime() + 1000));
      await t.http.get(`/v1/news/${r.body.slug}`).set(as(sciStudent.token, tf.slug)).expect(200);
      await news.sweep(new Date(at.getTime() + 3_700_000));
      await t.http.get(`/v1/news/${r.body.slug}`).set(as(sciStudent.token, tf.slug)).expect(404);
    });

    it('urgent unpublish needs the permission and a reason (NWS-12); every save is a version (NWS-11)', async () => {
      await t.http.post(`/v1/admin/news/${restricted.id}/unpublish`).set(as(approver.token, tf.slug)).send({ reason: 'اشتباه' }).expect(403);
      await t.http.post(`/v1/admin/news/${restricted.id}/unpublish`).set(admin()).send({}).expect(400);
      const u = await t.http.post(`/v1/admin/news/${restricted.id}/unpublish`).set(admin()).send({ reason: 'تاریخ اشتباه' }).expect(200);
      expect(u.body.status).toBe('archived');
      await t.http.get(`/v1/news/${restricted.slug}`).set(as(engStudent.token, tf.slug)).expect(404);
      expect(u.body.versions.length).toBeGreaterThanOrEqual(1);
      expect(u.body.history.map((h: { type: string }) => h.type)).toEqual(expect.arrayContaining(['created', 'submitted', 'approved', 'published']));
    });
  });

  describe('events', () => {
    let ev = '';

    it('organisers manage events of their unit only (EVT-01)', async () => {
      const base = { title: 'همایش هوش مصنوعی', startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 7 * 86_400_000 + 7_200_000).toISOString() };
      await t.http.post('/v1/admin/events').set(as(organiser.token, tf.slug)).send({ ...base, organizerUnitId: sci, visibility: 'own_tenant', registrationRule: { members: true } }).expect(403);
      const r = await t.http
        .post('/v1/admin/events')
        .set(as(organiser.token, tf.slug))
        .send({
          ...base,
          organizerUnitId: eng,
          visibility: 'public',
          registrationRule: { units: [{ id: eng, tree: true }], tenants: [other.id] },
          capacity: 2,
          waitlist: true,
          form: [{ key: 'diet', label: 'رژیم غذایی', type: 'select', required: true, options: [{ value: 'normal', label: 'عادی' }, { value: 'veg', label: 'گیاهی' }] }],
        })
        .expect(201);
      ev = r.body.id;
      await t.http.post(`/v1/admin/events/${ev}/status`).set(as(organiser.token, tf.slug)).send({ status: 'registration_open' }).expect(200);
    });

    it('visibility and registration rule are separate (EVT-02/03)', async () => {
      // public: anonymous and other universities can see it
      const anon = await t.http.get('/v1/events').set({ 'x-tenant': other.slug }).expect(200);
      expect(anon.body.map((e: { id: string }) => e.id)).toContain(ev);
      // seeing is not registering: a science student is outside the unit rule
      await t.http.get(`/v1/events/${ev}`).set(as(sciStudent.token, tf.slug)).expect(200);
      await t.http.post(`/v1/events/${ev}/registrations`).set(as(sciStudent.token, tf.slug)).send({ answers: { diet: 'normal' } }).expect(403);
      await t.http.post(`/v1/events/${ev}/registrations`).set({ 'x-tenant': tf.slug }).send({ answers: { diet: 'normal' } }).expect(401);
    });

    it('registration validates the form, is idempotent and wait-lists past capacity (EVT-04/05/07)', async () => {
      await t.http.post(`/v1/events/${ev}/registrations`).set(as(engStudent.token, tf.slug)).send({ answers: {} }).expect(400);
      const a = await t.http.post(`/v1/events/${ev}/registrations`).set(as(engStudent.token, tf.slug)).send({ answers: { diet: 'veg' } }).expect(201);
      expect(a.body.status).toBe('registered');
      const again = await t.http.post(`/v1/events/${ev}/registrations`).set(as(engStudent.token, tf.slug)).send({ answers: { diet: 'veg' } }).expect(201);
      expect(again.body).toMatchObject({ id: a.body.id, duplicate: true });
      // a member of the other (listed) university registers from their own portal
      const b = await t.http.post(`/v1/events/${ev}/registrations`).set(as(outsider.token, other.slug)).send({ answers: { diet: 'normal' } }).expect(201);
      expect(b.body.status).toBe('registered');
      const c = await t.http.post(`/v1/events/${ev}/registrations`).set(as(organiser.token, tf.slug)).send({ answers: { diet: 'normal' } }).expect(201);
      expect(c.body.status).toBe('waitlisted');
      const mine = await t.http.get('/v1/me/event-registrations').set(as(outsider.token, other.slug)).expect(200);
      expect(mine.body[0]).toMatchObject({ eventId: ev, status: 'registered' });

      // cancelling frees a seat and promotes the wait-listed person
      await t.http.post(`/v1/me/event-registrations/${b.body.id}/cancel`).set(as(outsider.token, other.slug)).expect(200);
      const list = await t.http.get(`/v1/admin/events/${ev}/registrations`).set(as(organiser.token, tf.slug)).expect(200);
      expect(list.body.find((r: { id: string }) => r.id === c.body.id).status).toBe('registered');
      await t.flush();
      expect((await inbox(organiser.userId)).some((n) => n.event === 'event.promoted')).toBe(true);
    });

    it('organisers export registrations as Excel-friendly CSV and mark attendance (EVT-06)', async () => {
      await t.http.get(`/v1/admin/events/${ev}/registrations`).set(as(sciStudent.token, tf.slug)).expect(403);
      const csv = await t.http.get(`/v1/admin/events/${ev}/registrations.csv`).set(as(organiser.token, tf.slug)).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      const body = csv.body as Buffer;
      expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(body.toString('utf8')).toContain('رژیم غذایی');
      const list = await t.http.get(`/v1/admin/events/${ev}/registrations`).set(as(organiser.token, tf.slug)).expect(200);
      const active = list.body.find((r: { status: string }) => r.status === 'registered');
      await t.http.post(`/v1/admin/event-registrations/${active.id}/attendance`).set(as(organiser.token, tf.slug)).send({ attended: true }).expect(200);
    });

    it('own-tenant events stay inside the university; cancelling notifies registrants (EVT-08)', async () => {
      const r = await t.http
        .post('/v1/admin/events')
        .set(as(organiser.token, tf.slug))
        .send({ title: 'جلسه داخلی', organizerUnitId: eng, startsAt: new Date(Date.now() + 86_400_000).toISOString(), endsAt: new Date(Date.now() + 90_000_000).toISOString(), visibility: 'own_tenant', registrationRule: { members: true } })
        .expect(201);
      await t.http.post(`/v1/admin/events/${r.body.id}/status`).set(as(organiser.token, tf.slug)).send({ status: 'registration_open' }).expect(200);
      await t.http.get(`/v1/events/${r.body.id}`).set(as(outsider.token, other.slug)).expect(404);
      await t.http.post(`/v1/events/${r.body.id}/registrations`).set(as(sciStudent.token, tf.slug)).send({}).expect(201);
      await t.http.post(`/v1/admin/events/${r.body.id}/status`).set(as(organiser.token, tf.slug)).send({ status: 'cancelled', reason: 'تداخل برنامه' }).expect(200);
      await t.flush();
      expect((await inbox(sciStudent.userId)).some((n) => n.event === 'event.cancelled')).toBe(true);
    });
  });
});
