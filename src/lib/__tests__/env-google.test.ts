import { describe, it, expect, beforeEach } from "vitest";
import { getCapabilities, _resetCapabilities } from "../env";

/**
 * The diagnostics banner used to complain whenever no client *secret* was set —
 * first as "Google Calendar sync is unavailable" (untrue once calendars could
 * be connected with a browser-granted token), then as a note about hour-long
 * connections. Both sent people hunting for a secret they had deliberately
 * chosen not to keep, so now only the missing *public* client ID is reported.
 */
function note(matcher: RegExp): string | undefined {
  _resetCapabilities();
  return getCapabilities().notes.find((n) => matcher.test(n));
}

describe("Google capabilities", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    _resetCapabilities();
  });

  it("flags the public client ID as the thing that gates sign-in", () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "x.apps.googleusercontent.com";
    _resetCapabilities();
    const caps = getCapabilities();
    expect(caps.hasGoogleSignIn).toBe(true);
    expect(caps.hasGoogleCalendar).toBe(false); // no secret → no background sync
  });

  it("requires BOTH id and secret for lasting sync", () => {
    process.env.GOOGLE_CLIENT_ID = "x.apps.googleusercontent.com";
    _resetCapabilities();
    expect(getCapabilities().hasGoogleCalendar).toBe(false);
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-secret";
    _resetCapabilities();
    expect(getCapabilities().hasGoogleCalendar).toBe(true);
  });

  it("warns when the public client ID is missing", () => {
    expect(note(/NEXT_PUBLIC_GOOGLE_CLIENT_ID not set/)).toBeTruthy();
  });

  it("says nothing at all when only the secret is missing", () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "x.apps.googleusercontent.com";
    expect(note(/Google Calendar sync is unavailable/)).toBeUndefined();
    expect(note(/NEXT_PUBLIC_GOOGLE_CLIENT_ID not set/)).toBeUndefined();
    // A shorter-lived connection is a per-account detail the calendar UI
    // already surfaces; it does not warrant an app-wide banner.
    expect(note(/Google/)).toBeUndefined();
  });

  it("says nothing about Google once both are configured", () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "x.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_ID = "x.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-secret";
    expect(note(/Google/)).toBeUndefined();
  });
});
