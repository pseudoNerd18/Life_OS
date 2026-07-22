import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/session";
import { authUrl, googleConfig } from "@/lib/calendar/google";

export const runtime = "nodejs";

const STATE_COOKIE = "gcal_oauth_state";

/** Starts the OAuth dance: redirects to Google's consent screen. */
export async function GET() {
  const cfg = googleConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: "Google Calendar is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." },
      { status: 503 },
    );
  }

  const user = await currentUser();

  // CSRF guard: a random value echoed back by Google and checked in the
  // callback, so a stray/forged callback can't attach an account to this user.
  // The user id rides along so the callback binds the tokens to the right row
  // even if the cookie jar is re-read on a different request.
  const state = `${crypto.randomUUID().replace(/-/g, "")}.${user.id}`;
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // must survive the top-level redirect back from Google
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(authUrl(cfg, state));
}
