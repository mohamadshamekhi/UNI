import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, API_URL, clearSessionCookies } from "@/lib/server/session";

export async function POST(req: NextRequest) {
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
