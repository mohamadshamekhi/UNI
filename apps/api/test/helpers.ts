import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import request from 'supertest';
import { createApp } from '../src/bootstrap.js';
import { MemorySmsProvider } from '../src/infra/sms.js';
import { OutboxService } from '../src/modules/outbox/outbox.service.js';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  sms: MemorySmsProvider;
  outbox: OutboxService;
  close: () => Promise<void>;
}

let seq = 0;
/** Unique Iranian mobile per call (valid MCI prefix). */
export const nextMobile = () => `0912${String(Date.now() % 1000).padStart(3, '0')}${String(++seq).padStart(4, '0')}`;
export const toE164 = (local: string) => `+98${local.slice(1)}`;
export const uniq = (p: string) => `${p}${Date.now().toString(36)}${++seq}`;

export async function startApp(): Promise<TestApp> {
  const app = await createApp();
  await app.init();
  return {
    app,
    http: request(app.getHttpServer()),
    sms: app.get(MemorySmsProvider),
    outbox: app.get(OutboxService),
    close: () => app.close(),
  };
}

export const sysPool = () => new pg.Pool({ connectionString: process.env.DATABASE_SYSTEM_URL });

/** Platform admin straight in the DB (what `db:seed` does). */
export async function createPlatformAdmin(t: TestApp, password = 'Platform#Pass1') {
  const mobile = nextMobile();
  const pool = sysPool();
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO users (mobile, full_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [toE164(mobile), 'مدیر کل', await hash(password)],
  );
  await pool.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [rows[0]!.id]);
  await pool.end();
  return { token: await login(t, mobile, password), userId: rows[0]!.id };
}

export async function login(t: TestApp, identifier: string, password: string): Promise<string> {
  const res = await t.http.post('/v1/auth/login').send({ identifier, password }).expect(200);
  return res.body.accessToken as string;
}

/** Sets a password for an account created by invitation, via the OTP reset flow. */
export async function setPasswordViaReset(t: TestApp, mobile: string, password: string) {
  await t.http.post('/v1/auth/otp/request').send({ mobile, purpose: 'reset_password' }).expect(202);
  const code = otpFrom(t, mobile);
  const { body } = await t.http.post('/v1/auth/otp/verify').send({ mobile, purpose: 'reset_password', code }).expect(200);
  await t.http.post('/v1/auth/password/reset').send({ proof: body.proof, newPassword: password }).expect(204);
}

export function otpFrom(t: TestApp, mobile: string): string {
  const msg = t.sms.lastTo(toE164(mobile));
  const code = msg?.text.match(/\d{6}/)?.[0];
  if (!code) throw new Error(`no OTP sent to ${mobile}`);
  return code;
}

export interface TenantFixture {
  id: string;
  slug: string;
  adminToken: string;
  adminMobile: string;
  facultyTypeId: string;
}

/** Active tenant with an introduced university admin who has a password. */
export async function createTenant(t: TestApp, platformToken: string, slug = uniq('t')): Promise<TenantFixture> {
  const auth = { authorization: `Bearer ${platformToken}` };
  const { body: tenant } = await t.http.post('/v1/platform/tenants').set(auth).send({ slug, nameFa: `دانشگاه ${slug}` }).expect(201);
  const adminMobile = nextMobile();
  await t.http.post(`/v1/platform/tenants/${tenant.id}/admins`).set(auth).send({ mobile: adminMobile, fullName: 'مدیر دانشگاه' }).expect(201);
  await t.http.post(`/v1/platform/tenants/${tenant.id}/status`).set(auth).send({ status: 'active', reason: 'test' }).expect(200);
  await setPasswordViaReset(t, adminMobile, 'Admin#Pass123');
  const adminToken = await login(t, adminMobile, 'Admin#Pass123');
  const { body: types } = await t.http.get('/v1/admin/unit-types').set({ authorization: `Bearer ${adminToken}`, 'x-tenant': slug }).expect(200);
  return { id: tenant.id, slug, adminToken, adminMobile, facultyTypeId: types.find((x: { key: string }) => x.key === 'faculty').id };
}

export const as = (token: string, tenant?: string) => ({ authorization: `Bearer ${token}`, ...(tenant ? { 'x-tenant': tenant } : {}) });

/** Minimal valid PNG (1×1). */
export const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

export async function createUnit(t: TestApp, tf: TenantFixture, nameFa: string, parentId?: string, typeId?: string) {
  const { body } = await t.http
    .post('/v1/admin/units')
    .set(as(tf.adminToken, tf.slug))
    .send({ nameFa, typeId: typeId ?? tf.facultyTypeId, ...(parentId ? { parentId } : {}) })
    .expect(201);
  return body as { id: string; path: string };
}

/** Full public registration: OTP → proof → document upload → registration. */
export async function registerStudent(t: TestApp, tf: TenantFixture, unitId: string, opts: { password?: string; memberNo?: string } = {}) {
  const mobile = nextMobile();
  await t.http.post('/v1/auth/otp/request').set({ 'x-tenant': tf.slug }).send({ mobile, purpose: 'register' }).expect(202);
  const code = otpFrom(t, mobile);
  const { body: proof } = await t.http.post('/v1/auth/otp/verify').send({ mobile, purpose: 'register', code }).expect(200);
  const { body: file } = await t.http
    .post('/v1/files')
    .set({ 'x-tenant': tf.slug, 'x-mobile-proof': proof.proof })
    .field('purpose', 'membership_document')
    .attach('file', PNG, 'card.png')
    .expect(201);
  const password = opts.password ?? 'Student#Pass1';
  const { body } = await t.http
    .post('/v1/registrations')
    .set({ 'x-tenant': tf.slug })
    .send({
      mobileProof: proof.proof,
      kind: 'student',
      unitId,
      memberNo: opts.memberNo ?? uniq('s'),
      fullName: 'علي رضايي',
      password,
      profile: { degree: 'msc' },
      documentFileIds: [file.id],
      acceptTerms: true,
    })
    .expect(201);
  return { mobile, password, membershipId: body.membershipId as string, userId: body.userId as string, fileId: file.id as string };
}
