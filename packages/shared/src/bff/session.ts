import type { NextResponse } from "next/server";

export const API_URL = process.env.API_URL ?? "http://localhost:4000";

export const ACCESS_COOKIE = "uni_at";
export const REFRESH_COOKIE = "uni_rt";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresInSec: number;
}

const secure = process.env.NODE_ENV === "production";

/** Tokens live only in httpOnly cookies; client JS never sees them. */
export function setSessionCookies(res: NextResponse, t: TokenPair) {
  res.cookies.set(ACCESS_COOKIE, t.accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: t.accessExpiresInSec,
  });
  res.cookies.set(REFRESH_COOKIE, t.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
}

export function clearSessionCookies(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, "", { path: "/", maxAge: 0 });
}

export async function refreshTokens(refreshToken: string): Promise<TokenPair | null> {
  const res = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  });
  return res.ok ? ((await res.json()) as TokenPair) : null;
}
