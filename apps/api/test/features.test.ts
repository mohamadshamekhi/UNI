import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentStep, totpAt } from '../src/common/util/totp.js';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service.js';
import { as, createPlatformAdmin, createTenant, createUnit, login, nextMobile, PNG, registerStudent, startApp, uniq, type TenantFixture, type TestApp } from './helpers.js';

describe('phase 1 completion features', () => {
  let t: TestApp;
  let tf: TenantFixture;
  let faculty: { id: string };

  beforeAll(async () => {
    t = await startApp();
    const platform = await createPlatformAdmin(t);
    tf = await createTenant(t, platform.token);
    faculty = await createUnit(t, tf, 'دانشکده فنی');
    await t.http.patch(`/v1/admin/units/${faculty.id}`).set(as(tf.adminToken, tf.slug)).send({ code: 'ENG' }).expect(200);
  });
  afterAll(() => t.close());

  describe('bulk import (AUTH-16)', () => {
    it('dry run validates every row; commit creates only valid ones', async () => {
      const ok1 = nextMobile();
      const ok2 = nextMobile();
      const csv = [
        'نوع,نام و نام خانوادگی,موبایل,ایمیل,واحد,شماره',
        `استاد,مریم احمدی,${ok1},m@example.ac.ir,ENG,${uniq('P')}`,
        `کارمند,علي كريمي,${ok2},,دانشکده فنی,`,
        `استاد,ب,09120,,ENG,`,
        `استاد,سارا نوری,${ok1},,ENG,`,
        `دانشجو,رضا رضایی,${nextMobile()},,واحد ناموجود,`,
      ].join('\n');
      const dry = await t.http
        .post('/v1/admin/memberships/import?dryRun=true')
        .set(as(tf.adminToken, tf.slug))
        .attach('file', Buffer.from('﻿' + csv), 'members.csv')
        .expect(200);
      expect(dry.body).toMatchObject({ dryRun: true, total: 5, ready: 2, failed: 3, created: 0 });
      expect(dry.body.rows[2].errors.length).toBeGreaterThan(0);
      expect(dry.body.rows[3].errors.join()).toContain('تکراری');

      const done = await t.http
        .post('/v1/admin/memberships/import?dryRun=false')
        .set(as(tf.adminToken, tf.slug))
        .attach('file', Buffer.from(csv), 'members.csv')
        .expect(200);
      expect(done.body).toMatchObject({ created: 2, failed: 3 });
      // second run: everyone already a member
      const again = await t.http.post('/v1/admin/memberships/import?dryRun=true').set(as(tf.adminToken, tf.slug)).attach('file', Buffer.from(csv), 'members.csv').expect(200);
      expect(again.body.ready).toBe(0);
    });

    it('requires membership.manage and the mandatory columns', async () => {
      const s = await registerStudent(t, tf, faculty.id);
      await t.http.post(`/v1/admin/memberships/${s.membershipId}/approve`).set(as(tf.adminToken, tf.slug)).send({}).expect(200);
      const token = await login(t, s.mobile, s.password);
      await t.http.post('/v1/admin/memberships/import').set(as(token, tf.slug)).attach('file', Buffer.from('a,b\n1,2'), 'x.csv').expect(403);
      const bad = await t.http.post('/v1/admin/memberships/import').set(as(tf.adminToken, tf.slug)).attach('file', Buffer.from('a,b\n1,2'), 'x.csv').expect(400);
      expect(bad.body.error.details.reason).toBe('missing_columns');
    });
  });

  describe('two-factor login (AUTH-12)', () => {
    it('enrol, login with TOTP, no replay, recovery code once, disable', async () => {
      const s = await registerStudent(t, tf, faculty.id);
      const token = await login(t, s.mobile, s.password);
      const setup = await t.http.post('/v1/auth/2fa/setup').set(as(token)).expect(200);
      expect(setup.body.otpauthUri).toContain('otpauth://totp/');
      const secret = setup.body.secret as string;
      await t.http.post('/v1/auth/2fa/enable').set(as(token)).send({ code: '000000' === totpAt(secret, currentStep()) ? '111111' : '000000' }).expect(400);
      const enabled = await t.http.post('/v1/auth/2fa/enable').set(as(token)).send({ code: totpAt(secret, currentStep()) }).expect(200);
      expect(enabled.body.recoveryCodes).toHaveLength(8);

      const first = await t.http.post('/v1/auth/login').send({ identifier: s.mobile, password: s.password }).expect(200);
      expect(first.body).toMatchObject({ mfaRequired: true });
      expect(first.body.accessToken).toBeUndefined();
      // the enable call already used the current step, so use the next one (within drift window)
      const code = totpAt(secret, currentStep() + 1);
      const ok = await t.http.post('/v1/auth/login/2fa').send({ mfaToken: first.body.mfaToken, code }).expect(200);
      expect(ok.body.accessToken).toBeTruthy();
      // the same challenge and the same code cannot be reused
      await t.http.post('/v1/auth/login/2fa').send({ mfaToken: first.body.mfaToken, code }).expect(401);
      const second = await t.http.post('/v1/auth/login').send({ identifier: s.mobile, password: s.password }).expect(200);
      await t.http.post('/v1/auth/login/2fa').send({ mfaToken: second.body.mfaToken, code }).expect(400);

      const recovery = enabled.body.recoveryCodes[0] as string;
      await t.http.post('/v1/auth/login/2fa').send({ mfaToken: second.body.mfaToken, code: recovery }).expect(200);
      const third = await t.http.post('/v1/auth/login').send({ identifier: s.mobile, password: s.password }).expect(200);
      await t.http.post('/v1/auth/login/2fa').send({ mfaToken: third.body.mfaToken, code: recovery }).expect(400);

      const status = await t.http.get('/v1/auth/2fa').set(as(ok.body.accessToken)).expect(200);
      expect(status.body).toMatchObject({ enabled: true, recoveryCodesLeft: 7 });
      await t.http.post('/v1/auth/2fa/disable').set(as(ok.body.accessToken)).send({ password: s.password, code: enabled.body.recoveryCodes[1] }).expect(204);
      const plain = await t.http.post('/v1/auth/login').send({ identifier: s.mobile, password: s.password }).expect(200);
      expect(plain.body.accessToken).toBeTruthy();
    });
  });

  describe('branding logo (UX-10) and document preview (FIL-11)', () => {
    it('only settings editors upload logos; public endpoint serves the saved one', async () => {
      await t.http.get(`/v1/public/tenants/${tf.slug}/logo`).expect(404);
      const s = await registerStudent(t, tf, faculty.id);
      await t.http.post(`/v1/admin/memberships/${s.membershipId}/approve`).set(as(tf.adminToken, tf.slug)).send({}).expect(200);
      const student = await login(t, s.mobile, s.password);
      await t.http.post('/v1/files').set(as(student, tf.slug)).field('purpose', 'branding_logo').attach('file', PNG, 'logo.png').expect(403);

      const up = await t.http.post('/v1/files').set(as(tf.adminToken, tf.slug)).field('purpose', 'branding_logo').attach('file', PNG, 'logo.png').expect(201);
      // a membership document cannot be used as a logo
      await t.http.patch('/v1/admin/tenant/settings').set(as(tf.adminToken, tf.slug)).send({ branding: { logoFileId: s.fileId } }).expect(400);
      await t.http.patch('/v1/admin/tenant/settings').set(as(tf.adminToken, tf.slug)).send({ branding: { logoFileId: up.body.id } }).expect(200);
      const logo = await t.http.get(`/v1/public/tenants/${tf.slug}/logo`).expect(200);
      expect(logo.headers['content-type']).toBe('image/png');
      expect(logo.headers['cache-control']).toContain('public');
    });

    it('preview links are inline only for images/PDF and stay single-use', async () => {
      const s = await registerStudent(t, tf, faculty.id);
      const link = await t.http.post(`/v1/files/${s.fileId}/download-link`).set(as(tf.adminToken, tf.slug)).send({ inline: true }).expect(201);
      expect(link.body.inline).toBe(true);
      const res = await t.http.get(link.body.url).expect(200);
      expect(res.headers['content-disposition']).toMatch(/^inline;/);
      expect(res.headers['content-security-policy']).toContain('sandbox');
      await t.http.get(link.body.url).expect(403);
      const audit = await t.http.get(`/v1/admin/audit?action=file.confidential.viewed&targetId=${s.fileId}`).set(as(tf.adminToken, tf.slug)).expect(200);
      expect(audit.body[0].after.mode).toBe('preview');
      expect(audit.body[0].actorName).toBe('مدیر دانشگاه');
    });
  });

  describe('retention (FIL-09)', () => {
    it('expires documents of decided memberships after the policy and purges them later', async () => {
      const s = await registerStudent(t, tf, faculty.id);
      await t.http.post(`/v1/admin/memberships/${s.membershipId}/reject`).set(as(tf.adminToken, tf.slug)).send({ reason: 'ناقص' }).expect(200);
      await t.http.patch('/v1/admin/tenant/settings').set(as(tf.adminToken, tf.slug)).send({ retention: { membershipDocsDays: 30 } }).expect(200);
      const maintenance = t.app.get(MaintenanceService);

      const soon = await maintenance.run(new Date(Date.now() + 10 * 86400_000));
      expect(soon?.documentsExpired).toBe(0);
      const later = await maintenance.run(new Date(Date.now() + 31 * 86400_000));
      expect(later!.documentsExpired).toBeGreaterThanOrEqual(1);
      const purge = await maintenance.run(new Date(Date.now() + 40 * 86400_000));
      expect(purge!.filesPurged).toBeGreaterThanOrEqual(1);

      const pool = new pg.Pool({ connectionString: process.env.DATABASE_SYSTEM_URL });
      const { rows } = await pool.query('select deleted_at, purged_at from file_objects where id = $1', [s.fileId]);
      await pool.end();
      expect(rows[0].deleted_at).toBeTruthy();
      expect(rows[0].purged_at).toBeTruthy();
      await t.http.post(`/v1/files/${s.fileId}/download-link`).set(as(tf.adminToken, tf.slug)).send({}).expect(404);
    });
  });
});
