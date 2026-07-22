import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { CALENDAR_SCOPE, inspectAccessToken } from "@/lib/calendar/google";
import { googleClientId } from "@/lib/auth/google-id-token";
import { grantedCalendarAccess } from "@/lib/calendar/link";
import { rateLimitFor } from "@/lib/server/ratelimit";
import { safeTz } from "@/lib/time";
import { syncAccount } from "@/lib/calendar/sync";
import type { AccountRow } from "@/lib/calendar/tokens";

export const runtime = "nodejs";

/**
 * Accept a calendar access token the browser obtained from Google Identity
 * Services, and connect the calendar with it.
 *
 * This is the no-secret path. Google only issues refresh tokens to the
 * authorization-code flow, which requires a client secret, so what arrives here
 * is good for about an hour and cannot be renewed silently — the stored account
 * deliberately has `refreshToken: null` to record that.
 *
 * The token is opaque, so every property is taken from Google's tokeninfo
 * endpoint rather than trusted from the request body. In particular the
 * audience check is what stops a token minted for another application being
 * replayed here to attach someone else's calendar.
 */
export async function POST(req: Request) {
  const user = await currentUser();

  const rl = await rateLimitFor("calendarSync", user.id);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts — try again shortly." }, { status: 429 });
  }

  const clientId = googleClientId();
  if (!clientId) {
    return NextResponse.json(
      { error: "Google is not configured on this server." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as { accessToken?: unknown } | null;
  const accessToken = typeof body?.accessToken === "string" ? body.accessToken : null;
  if (!accessToken) return NextResponse.json({ error: "Missing access token." }, { status: 400 });

  let info;
  try {
    info = await inspectAccessToken(accessToken);
  } catch (err) {
    console.error("[calendar] tokeninfo failed:", (err as Error).message);
    return NextResponse.json({ error: "Google rejected that authorisation." }, { status: 400 });
  }

  // Token substitution guard: only tokens minted for *this* client are ours.
  if (info.audience !== clientId) {
    console.error("[calendar] access token audience mismatch:", info.audience);
    return NextResponse.json({ error: "That authorisation was not issued to this app." }, { status: 403 });
  }

  if (!grantedCalendarAccess(info.scopes.join(" "))) {
    return NextResponse.json(
      { error: "Calendar permission was not granted.", scope: CALENDAR_SCOPE },
      { status: 400 },
    );
  }

  // Google returns the granting account's address; fall back to the signed-in
  // user's so the (userId, provider, email) key always has a value.
  const email = info.email ?? user.email;
  if (!email) {
    return NextResponse.json({ error: "Could not determine the Google account." }, { status: 400 });
  }

  const expiresAt = new Date(Date.now() + Math.max(60, info.expiresInSec) * 1000);

  const account: AccountRow = await prisma.calendarAccount.upsert({
    where: { userId_provider_email: { userId: user.id, provider: "GOOGLE", email } },
    create: {
      userId: user.id,
      provider: "GOOGLE",
      email,
      accessToken,
      refreshToken: null, // browser-granted: nothing to refresh with
      expiresAt,
      scope: info.scopes.join(" "),
      calendarId: "primary",
      isActive: true,
    },
    update: {
      accessToken,
      expiresAt,
      scope: info.scopes.join(" "),
      isActive: true,
      // Re-granting invalidates any cursor we were holding.
      syncToken: null,
    },
  });

  // Sync immediately — the token is short-lived, so waiting for a later trigger
  // wastes most of its life.
  try {
    const report = await syncAccount(account, { timeZone: safeTz(user.timezone) });
    return NextResponse.json({ email, expiresAt, sessionOnly: true, report });
  } catch (err) {
    return NextResponse.json(
      { email, expiresAt, sessionOnly: true, error: (err as Error).message },
      { status: 207 },
    );
  }
}
