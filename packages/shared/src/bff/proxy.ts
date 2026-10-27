import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  API_URL,
  REFRESH_COOKIE,
  clearSessionCookies,
  refreshTokens,
  setSessionCookies,
  type TokenPair,
} from "./session";

/**
 * Backend-for-frontend: forwards /api/proxy/<path> to the API with the access token from the
 * httpOnly cookie, refreshing it once on 401. Only /v1/* paths are forwarded.
 */
// x-forwarded-for comes from the edge proxy in front of Next; the API trusts it for per-IP limits
const FORWARD_REQUEST_HEADERS = ["content-type", "x-tenant", "x-request-id", "accept", "x-forwarded-for", "x-mobile-proof", "x-guest-token"];
const FORWARD_RESPONSE_HEADERS = ["content-type", "content-disposition", "content-length", "x-request-id", "cache-control"];

async function forward(req: NextRequest, path: string[], body: ArrayBuffer | undefined, token?: string) {
  const url = new URL(`${API_URL}/${path.map(encodeURIComponent).join("/")}`);
  url.search = req.nextUrl.search;
  const headers = new Headers();
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (token) headers.set("authorization", `Bearer ${token}`);
  const ua = req.headers.get("user-agent");
  if (ua) headers.set("user-agent", ua);
  return fetch(url, { method: req.method, headers, body, cache: "no-store", redirect: "manual" });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path[0] !== "v1") return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });

  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  let res = await forward(req, path, body, req.cookies.get(ACCESS_COOKIE)?.value);
  let refreshed: TokenPair | null = null;

  if (res.status === 401) {
    const rt = req.cookies.get(REFRESH_COOKIE)?.value;
    refreshed = rt ? await refreshTokens(rt) : null;
    if (refreshed) res = await forward(req, path, body, refreshed.accessToken);
  }

  const headers = new Headers();
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  const out = new NextResponse(res.status === 204 ? null : res.body, { status: res.status, headers });
  if (refreshed) setSessionCookies(out, refreshed);
  else if (res.status === 401) clearSessionCookies(out);
  return out;
}

export const proxyHandler = handle;
