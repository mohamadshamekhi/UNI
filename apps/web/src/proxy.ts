import { NextResponse, type NextRequest } from "next/server";

const BASE = (process.env.TENANT_BASE_DOMAIN ?? "uni.localhost").toLowerCase();

/**
 * 1) <slug>.<TENANT_BASE_DOMAIN> → /<slug>/… (each university on its own subdomain, TEN-01)
 * 2) /<slug>/me requires a session; everything else in the portal is public.
 */
export function proxy(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0]!.toLowerCase();
  const url = req.nextUrl.clone();
  if (host.endsWith(`.${BASE}`)) {
    const slug = host.slice(0, -(BASE.length + 1));
    if (/^[a-z0-9-]{1,40}$/.test(slug) && !url.pathname.startsWith(`/${slug}`)) {
      url.pathname = `/${slug}${url.pathname === "/" ? "" : url.pathname}`;
      return NextResponse.rewrite(url);
    }
  }
  const m = url.pathname.match(/^\/([a-z0-9-]{1,40})\/me(\/|$)/);
  if (m && !req.cookies.has("uni_rt")) {
    const login = new URL(`/${m[1]}/login`, req.url);
    login.searchParams.set("next", url.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
