import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function apiEnv(): Record<string, string> {
  const text = readFileSync(join(root, "apps/api/.env"), "utf8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

export const WEB = process.env.E2E_WEB_URL ?? "http://localhost:3000";
export const BACKOFFICE = process.env.E2E_BACKOFFICE_URL ?? "http://localhost:3001";
export const TENANT = process.env.E2E_TENANT ?? "ut";
export const ADMIN = { mobile: process.env.E2E_ADMIN_MOBILE ?? "09120000000", password: process.env.E2E_ADMIN_PASSWORD ?? "ChangeMe!12345" };
export const KNOWN_CODE = "123456";

export const uniqueMobile = () => `0912${String(Date.now()).slice(-7)}`;

/**
 * The dev SMS provider only logs codes, so tests overwrite the latest challenge with a known
 * code (same keyed hash the API uses). Dev databases only.
 */
export async function forceOtp(localMobile: string, purpose: string) {
  const env = apiEnv();
  const pool = new pg.Pool({ connectionString: env.DATABASE_SYSTEM_URL });
  try {
    const e164 = `+98${localMobile.slice(1)}`;
    const { rows } = await pool.query<{ id: string }>(
      "select id from otp_challenges where mobile = $1 and purpose = $2 and consumed_at is null order by created_at desc limit 1",
      [e164, purpose],
    );
    if (!rows[0]) throw new Error(`no OTP challenge for ${e164}`);
    const hash = createHmac("sha256", env.HASH_PEPPER!).update(`otp:${rows[0].id}:${KNOWN_CODE}`).digest("hex");
    await pool.query("update otp_challenges set code_hash = $1, attempts = 0 where id = $2", [hash, rows[0].id]);
  } finally {
    await pool.end();
  }
}

/** Minimal valid PNG (1×1) for the document upload step. */
export const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

export const API = process.env.E2E_API_URL ?? "http://localhost:4000";

type Api = import("@playwright/test").APIRequestContext;

/** JSON body of a successful API response; throws with the body otherwise. */
export async function ok<T>(p: Promise<import("@playwright/test").APIResponse>): Promise<T> {
  const r = await p;
  if (!r.ok()) throw new Error(`${r.url()} → ${r.status()} ${await r.text()}`);
  const text = await r.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const asTenant = (token: string) => ({ authorization: `Bearer ${token}`, "x-tenant": TENANT });

export async function apiLogin(api: Api, identifier: string, password: string) {
  return (await ok<{ accessToken: string }>(api.post(`${API}/v1/auth/login`, { data: { identifier, password } }))).accessToken;
}

/** Registers a student through the public API (dev OTP echo) and approves the membership. */
export async function approvedStudent(api: Api, adminToken: string, password: string, name = "دانشجوی آزمون") {
  const mobile = uniqueMobile();
  const units = await ok<{ id: string }[]>(api.get(`${API}/v1/public/units`, { headers: { "x-tenant": TENANT } }));
  const otp = await ok<{ devCode: string }>(api.post(`${API}/v1/auth/otp/request`, { headers: { "x-tenant": TENANT }, data: { mobile, purpose: "register" } }));
  const { proof } = await ok<{ proof: string }>(api.post(`${API}/v1/auth/otp/verify`, { data: { mobile, purpose: "register", code: otp.devCode } }));
  const file = await ok<{ id: string }>(
    api.post(`${API}/v1/files`, {
      headers: { "x-tenant": TENANT, "x-mobile-proof": proof },
      multipart: { purpose: "membership_document", file: { name: "card.png", mimeType: "image/png", buffer: PNG } },
    }),
  );
  const reg = await ok<{ membershipId: string }>(
    api.post(`${API}/v1/registrations`, {
      headers: { "x-tenant": TENANT },
      data: { mobileProof: proof, kind: "student", unitId: units[0]!.id, memberNo: `e2e${Date.now().toString(36)}`, fullName: name, password, profile: { degree: "msc" }, documentFileIds: [file.id], acceptTerms: true },
    }),
  );
  await ok(api.post(`${API}/v1/admin/memberships/${reg.membershipId}/approve`, { headers: asTenant(adminToken), data: {} }));
  return { mobile, password, membershipId: reg.membershipId };
}

/** Invites a faculty member (base faculty role, tenant-wide) and sets a password via the dev OTP echo. */
export async function facultyMember(api: Api, adminToken: string, password: string, fullName: string) {
  const mobile = uniqueMobile();
  const units = await ok<{ id: string }[]>(api.get(`${API}/v1/public/units`, { headers: { "x-tenant": TENANT } }));
  const inv = await ok<{ membershipId: string }>(api.post(`${API}/v1/admin/memberships/invite`, { headers: asTenant(adminToken), data: { kind: "faculty", fullName, mobile, unitId: units[0]!.id } }));
  const otp = await ok<{ devCode: string }>(api.post(`${API}/v1/auth/otp/request`, { headers: { "x-tenant": TENANT }, data: { mobile, purpose: "reset_password" } }));
  const { proof } = await ok<{ proof: string }>(api.post(`${API}/v1/auth/otp/verify`, { data: { mobile, purpose: "reset_password", code: otp.devCode } }));
  await ok(api.post(`${API}/v1/auth/password/reset`, { data: { proof, newPassword: password } }));
  return { mobile, password, membershipId: inv.membershipId };
}
