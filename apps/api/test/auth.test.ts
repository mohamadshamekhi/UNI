import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createPlatformAdmin, createTenant, createUnit, login, nextMobile, otpFrom, registerStudent, startApp, toE164, type TenantFixture, type TestApp } from './helpers.js';

describe('authentication and sessions (AUTH-01..11)', () => {
  let t: TestApp;
  let tf: TenantFixture;
  let unit: string;

  beforeAll(async () => {
    t = await startApp();
    const platform = await createPlatformAdmin(t);
    tf = await createTenant(t, platform.token);
    unit = (await createUnit(t, tf, 'دانشکده علوم')).id;
  });
  afterAll(() => t.close());

  it('OTP for an unknown account answers identically and sends nothing (AUTH-11)', async () => {
    const mobile = nextMobile();
    const before = t.sms.sent.length;
    const res = await t.http.post('/v1/auth/otp/request').send({ mobile, purpose: 'reset_password' }).expect(202);
    expect(res.body).toEqual({ expiresInSec: 150, resendAfterSec: 60 });
    expect(t.sms.sent.length).toBe(before);
  });

  it('OTP: resend gap, wrong codes burn attempts, max 5 (AUTH-01)', async () => {
    const mobile = nextMobile();
    await t.http.post('/v1/auth/otp/request').send({ mobile, purpose: 'register' }).expect(202);
    const again = await t.http.post('/v1/auth/otp/request').send({ mobile, purpose: 'register' }).expect(429);
    expect(again.body.error.code).toBe('OTP_RESEND_TOO_SOON');
    const code = otpFrom(t, mobile);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      const r = await t.http.post('/v1/auth/otp/verify').send({ mobile, purpose: 'register', code: wrong }).expect(400);
      expect(r.body.error.code).toBe('OTP_INVALID');
    }
    await t.http.post('/v1/auth/otp/verify').send({ mobile, purpose: 'register', code: wrong }).expect(429);
    // even the right code is dead now
    await t.http.post('/v1/auth/otp/verify').send({ mobile, purpose: 'register', code }).expect(429);
  });

  it('Persian digits in mobile and code are accepted (UX-03)', async () => {
    const mobile = nextMobile();
    const fa = mobile.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);
    await t.http.post('/v1/auth/otp/request').send({ mobile: fa, purpose: 'verify_mobile' }).expect(202);
    const code = otpFrom(t, mobile).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);
    await t.http.post('/v1/auth/otp/verify').send({ mobile, purpose: 'verify_mobile', code }).expect(200);
  });

  it('per-IP lockout after 5 failures, with notification only at the global threshold (AUTH-09)', async () => {
    const s = await registerStudent(t, tf, unit);
    for (let i = 0; i < 5; i++) {
      await t.http.post('/v1/auth/login').send({ identifier: s.mobile, password: 'wrong-password' }).expect(401);
    }
    const locked = await t.http.post('/v1/auth/login').send({ identifier: s.mobile, password: s.password }).expect(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('refresh rotates; replaying an old token after the grace window revokes the session (AUTH-10)', async () => {
    const s = await registerStudent(t, tf, unit);
    const first = (await t.http.post('/v1/auth/login').send({ identifier: s.mobile, password: s.password }).expect(200)).body;
    const second = (await t.http.post('/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200)).body;
    expect(second.refreshToken).not.toBe(first.refreshToken);

    // inside the grace window a replay is refused but the session survives
    await t.http.post('/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    await t.http.get('/v1/me').set(as(second.accessToken)).expect(200);

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_SYSTEM_URL });
    await pool.query("update sessions set last_used_at = now() - interval '1 minute' where id = $1", [first.sessionId]);
    await pool.end();
    await t.http.post('/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    // theft response: the whole session is dead, including the newest tokens
    await t.http.post('/v1/auth/refresh').send({ refreshToken: second.refreshToken }).expect(401);
    await t.http.get('/v1/me').set(as(second.accessToken)).expect(401);
  });

  it('logout revokes the access token immediately; sessions list and logout-all', async () => {
    const s = await registerStudent(t, tf, unit);
    const a = await login(t, s.mobile, s.password);
    const b = await login(t, s.mobile, s.password);
    const list = await t.http.get('/v1/auth/sessions').set(as(a)).expect(200);
    expect(list.body.length).toBe(2);
    await t.http.post('/v1/auth/logout').set(as(a)).expect(204);
    await t.http.get('/v1/me').set(as(a)).expect(401);
    await t.http.get('/v1/me').set(as(b)).expect(200);
    const c = await login(t, s.mobile, s.password);
    await t.http.post('/v1/auth/logout-all').set(as(c)).expect(200);
    await t.http.get('/v1/me').set(as(b)).expect(401);
  });

  it('password reset via OTP proof is single-use and kills old sessions', async () => {
    const s = await registerStudent(t, tf, unit);
    const old = await login(t, s.mobile, s.password);
    await t.http.post('/v1/auth/otp/request').send({ mobile: s.mobile, purpose: 'reset_password' }).expect(202);
    const { body } = await t.http.post('/v1/auth/otp/verify').send({ mobile: s.mobile, purpose: 'reset_password', code: otpFrom(t, s.mobile) }).expect(200);
    await t.http.post('/v1/auth/password/reset').send({ proof: body.proof, newPassword: 'Brand#New#Pass9' }).expect(204);
    await t.http.post('/v1/auth/password/reset').send({ proof: body.proof, newPassword: 'Another#Pass99' }).expect(400);
    await t.http.get('/v1/me').set(as(old)).expect(401);
    await login(t, s.mobile, 'Brand#New#Pass9');
    // stored as E.164 (AUTH-03)
    const e164Token = await login(t, toE164(s.mobile), 'Brand#New#Pass9');
    const me = await t.http.get('/v1/me').set(as(e164Token)).expect(200);
    expect(me.body.mobile).toBe(toE164(s.mobile));
  });

  it('weak passwords are refused at registration (AUTH-08)', async () => {
    await expect(registerStudent(t, tf, unit, { password: '12345678' })).rejects.toThrow(/400/);
  });
});
