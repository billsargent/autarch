import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isCrossSite, isPublicPath, isValidSession } from "@/lib/auth";

// Every page and API route needs a signed-in session (#3), except the login
// page and API, the health check and the village art. State-changing requests
// from other sites are refused.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isCrossSite(request.method, request.headers.get("host"), request.headers.get("origin"), request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  if (isPublicPath(pathname)) return NextResponse.next();
  if (isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next's own static files.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
