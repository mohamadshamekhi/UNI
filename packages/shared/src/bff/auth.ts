import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, API_URL, clearSessionCookies, setSessionCookies, type TokenPair } from "./session";

/** Exchanges credentials at an API login endpoint and stores the tokens in httpOnly cookies. */
export function loginHandler(apiPath: string) {
  return async function POST(req: NextRequest) {
    const body = await req.text();
    const res = await fetch(`${API_URL}${apiPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "",
        "user-agent": req.headers.get("user-agent") ?? "",
      },
      body,
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    // accounts with 2FA: no tokens yet, the client continues at /api/auth/login-2fa
    if (data?.mfaRequired) return NextResponse.json({ mfaRequired: true, mfaToken: data.mfaToken });
    const out = NextResponse.json({ ok: true });
    setSessionCookies(out, data as TokenPair);
    return out;
  };
}

export async function logoutHandler(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (token) {
    await fetch(`${API_URL}/v1/auth/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    }).catch(() => undefined);
  }
  const out = NextResponse.json({ ok: true });
  clearSessionCookies(out);
  return out;
}
