import { describe, it, expect, afterEach } from "vitest";
import { grantedCalendarAccess } from "../calendar/link";
import { safeCallback } from "../auth-redirect";
import { CALENDAR_SCOPE, GOOGLE_SCOPES } from "../calendar/google";

/**
 * Google's granular consent lets someone approve sign-in while unticking
 * calendar access, so nothing may assume the scope we asked for is the scope we
 * got. These cases are what stands between that and a CalendarAccount row whose
 * every sync 403s.
 */
describe("grantedCalendarAccess()", () => {
  it("accepts the full set we request", () => {
    expect(grantedCalendarAccess(GOOGLE_SCOPES.join(" "))).toBe(true);
  });

  it("accepts calendar.events on its own", () => {
    expect(grantedCalendarAccess(CALENDAR_SCOPE)).toBe(true);
  });

  it("rejects an identity-only grant — the user unticked calendar", () => {
    expect(grantedCalendarAccess("openid email profile")).toBe(false);
  });

  it("rejects read-only calendar, which cannot satisfy two-way sync", () => {
    expect(
      grantedCalendarAccess("openid email https://www.googleapis.com/auth/calendar.readonly"),
    ).toBe(false);
  });

  it("rejects missing, empty and whitespace scope strings", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(grantedCalendarAccess(v)).toBe(false);
    }
  });

  it("is not fooled by a scope that merely contains ours as a substring", () => {
    expect(grantedCalendarAccess(`${CALENDAR_SCOPE}.readonly`)).toBe(false);
  });

  it("tolerates the irregular whitespace Google sometimes returns", () => {
    expect(grantedCalendarAccess(`  openid\t${CALENDAR_SCOPE}\n email `)).toBe(true);
  });
});

/**
 * `callbackUrl` comes straight off the query string, so the login page would be
 * an open redirect if it echoed absolute URLs back.
 */
describe("safeCallback()", () => {
  it("keeps a same-site path", () => {
    expect(safeCallback("/calendar")).toBe("/calendar");
    expect(safeCallback("/goals/abc?x=1")).toBe("/goals/abc?x=1");
  });

  it("falls back to the dashboard when absent", () => {
    expect(safeCallback(undefined)).toBe("/dashboard");
    expect(safeCallback(null)).toBe("/dashboard");
    expect(safeCallback("")).toBe("/dashboard");
  });

  it("refuses an absolute URL to another origin", () => {
    expect(safeCallback("https://evil.example/steal")).toBe("/dashboard");
    expect(safeCallback("http://evil.example")).toBe("/dashboard");
  });

  it("refuses a protocol-relative URL, which browsers read as another host", () => {
    expect(safeCallback("//evil.example/steal")).toBe("/dashboard");
  });

  it("refuses a scheme-based payload", () => {
    expect(safeCallback("javascript:alert(1)")).toBe("/dashboard");
  });
});

/**
 * A browser-granted access token is opaque: unlike an ID token there is nothing
 * to verify locally, so everything about it comes from Google's tokeninfo
 * endpoint. The audience check is the load-bearing one — a token minted for a
 * different application would otherwise be replayed here to attach a calendar.
 */
describe("inspectAccessToken()", () => {
  const OURS = "ours.apps.googleusercontent.com";
  const realFetch = globalThis.fetch;

  function stubTokenInfo(status: number, body: Record<string, unknown>) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("reports the audience, email and scopes Google returns", async () => {
    stubTokenInfo(200, {
      aud: OURS,
      email: "Person@Example.com",
      scope: `openid ${CALENDAR_SCOPE}`,
      expires_in: 3599,
    });
    const { inspectAccessToken } = await import("../calendar/google");
    const info = await inspectAccessToken("opaque-token");
    expect(info.audience).toBe(OURS);
    expect(info.email).toBe("person@example.com"); // normalised for lookups
    expect(info.scopes).toContain(CALENDAR_SCOPE);
    expect(info.expiresInSec).toBe(3599);
  });

  it("surfaces a foreign audience rather than hiding it", async () => {
    stubTokenInfo(200, { aud: "someone-else.apps.googleusercontent.com", expires_in: 3599 });
    const { inspectAccessToken } = await import("../calendar/google");
    const info = await inspectAccessToken("stolen-token");
    // The route compares this against our client ID and rejects a mismatch;
    // what matters here is that the real value is reported, not normalised away.
    expect(info.audience).not.toBe(OURS);
  });

  it("throws when Google rejects the token", async () => {
    stubTokenInfo(400, { error: "invalid_token" });
    const { inspectAccessToken } = await import("../calendar/google");
    await expect(inspectAccessToken("expired")).rejects.toThrow(/rejected the access token/);
  });

  it("throws when the response carries no audience", async () => {
    stubTokenInfo(200, { email: "x@y.com", expires_in: 100 });
    const { inspectAccessToken } = await import("../calendar/google");
    await expect(inspectAccessToken("weird")).rejects.toThrow(/no audience/);
  });

  it("treats a grant without the calendar scope as insufficient", async () => {
    // Google's granular consent lets someone approve identity and untick
    // calendar; the token is then valid but useless for sync.
    expect(grantedCalendarAccess("openid email profile")).toBe(false);
    expect(grantedCalendarAccess(`openid ${CALENDAR_SCOPE}`)).toBe(true);
  });
});

/**
 * Google returns the same `access_denied` code whether the user clicked Cancel
 * or the app is in Testing mode and the account isn't an approved tester. Those
 * need different words on screen, so the description is what separates them.
 */
describe("calendar grant failure classification", () => {
  // Exercised through the module's exported classifier via the hook's contract.
  const cases: [string, string, string][] = [
    ["access_denied", "LifeOS has not completed the Google verification process", "not-a-tester"],
    ["access_denied", "The app is currently being tested, and can only be accessed by developer-approved testers", "not-a-tester"],
    ["access_denied", "user denied the request", "cancelled"],
    ["popup_closed", "", "cancelled"],
    ["popup_failed_to_open", "", "blocked"],
    ["something_new", "who knows", "unavailable"],
  ];

  it("separates a non-tester refusal from a cancelled popup", async () => {
    const { __classifyForTest } = await import("../../components/auth/use-google-calendar-grant");
    for (const [code, detail, expected] of cases) {
      const got = __classifyForTest(code, detail);
      expect(got.ok).toBe(false);
      expect(got.ok === false && got.reason, `${code} / ${detail}`).toBe(expected);
    }
  });
});
