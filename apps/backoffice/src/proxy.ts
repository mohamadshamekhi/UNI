import { NextResponse, type NextRequest } from "next/server";

/** Coarse gate: no session cookie → login. Real authorization is always enforced by the API. */
export function proxy(req: NextRequest) {
  if (req.cookies.has("uni_rt")) return NextResponse.next();
  const url = new URL("/login", req.url);
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
};
