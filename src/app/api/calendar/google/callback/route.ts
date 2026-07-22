import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { exchangeCode, getEmail, googleConfig } from "@/lib/calendar/google";
import { safeTz } from "@/lib/time";
import { syncAccount } from "@/lib/calendar/sync";
import type { AccountRow } from "@/lib/calendar/tokens";

export const runtime = "nodejs";

const STATE_COOKIE = "gcal_oauth_state";

/** Redirect back to the calendar with a short status the UI can render. */
function back(status: string, detail?: string) {
  const base = (process.env.APP_URL || "http://localhost:3010").replace(/\/$/, "");
  const p = new URLSearchParams({ gcal: status });
  if (detail) p.set("detail", detail.slice(0, 200));
  return NextResponse.redirect(`${base}/calendar?${p}`);
}

export async function GET(req: Request) {
  const cfg = googleConfig();
  if (!cfg) return back("unconfigured");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  // The user clicked "Cancel" on the consent screen — not an error.
  if (denied) return back("denied", denied);
  if (!code || !returnedState) return back("error", "missing code or state");

  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  if (!expected || expected !== returnedState) return back("error", "state mismatch");

  const user = await currentUser();
  // The state carries the user the flow started as; refuse if the browser
  // identity changed mid-flow rather than linking tokens to the wrong account.
  if (returnedState.split(".")[1] !== user.id) return back("error", "session changed mid-flow");

  try {
    const tokens = await exchangeCode(cfg, code);
    if (!tokens.refreshToken) {
      // Without a refresh token, sync would silently stop in an hour. Better to
      // fail loudly now and let the user re-consent.
      return back("error", "Google did not return a refresh token — try disconnecting and again");
    }
    const email = await getEmail(tokens.accessToken);

    const account: AccountRow = await prisma.calendarAccount.upsert({
      where: { userId_provider_email: { userId: user.id, provider: "GOOGLE", email } },
      create: {
        userId: user.id,
        provider: "GOOGLE",
        email,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
        calendarId: "primary",
        isActive: true,
      },
      update: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
        isActive: true,
        // Re-linking starts a fresh cursor; the old one may be invalid.
        syncToken: null,
      },
    });

    // First sync inline so the calendar isn't empty on the redirect. A failure
    // here must not undo a successful connection.
    try {
      await syncAccount(account, { timeZone: safeTz(user.timezone) });
    } catch (err) {
      return back("connected_nosync", (err as Error).message);
    }
    return back("connected", email);
  } catch (err) {
    return back("error", (err as Error).message);
  }
}
