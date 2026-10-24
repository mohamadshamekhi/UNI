import { NextResponse, type NextRequest } from "next/server";
import { API_URL, setSessionCookies, type TokenPair } from "@/lib/server/session";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const res = await fetch(`${API_URL}/v1/auth/login`, {
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
  const out = NextResponse.json({ ok: true });
  setSessionCookies(out, data as TokenPair);
  return out;
}
