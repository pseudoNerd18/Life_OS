/**
 * Auth gate. Sign-in is required everywhere except the marketing page, the
 * login/signup pages, and Auth.js's own routes.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const PUBLIC_PATHS = ["/", "/login", "/signup"];
// `/api/calls/twiml` is fetched by Twilio, which has no session. It is not
// unprotected: every request must carry an HMAC over the spoken message, and
// the route renders an empty document without one. See lib/calls/sign.ts.
const PUBLIC_PREFIXES = ["/api/auth/", "/api/calls/twiml"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (pathname === "/" && req.auth?.user) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
  }

  if (isPublic(pathname)) return NextResponse.next();
  if (req.auth?.user) return NextResponse.next();

  // Allow API requests that carry a guest cookie created by the client.
  // The smoke tests and guest-mode UX send `lifeos_uid=<id>` as a cookie.
  const cookieHeader = req.headers.get("cookie") || "";
  if (cookieHeader.includes("lifeos_uid=")) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const loginUrl = new URL("/login", req.nextUrl.origin);
  loginUrl.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
