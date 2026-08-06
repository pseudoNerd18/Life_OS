import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// Prisma is mocked wholesale: these tests are about which events the sweep
// picks and how it claims them, not about the database.
const findMany = vi.fn();
const updateMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { calendarEvent: { findMany: (...a: unknown[]) => findMany(...a), updateMany: (...a: unknown[]) => updateMany(...a) } },
}));

import { escapeXml, sayTwiml, twilioConfig } from "../calls/twilio";
import { unpack } from "../calls/sign";
import { reminderMessage, runDueReminders, LEAD_MS } from "../calls/reminders";

const NOW = new Date("2026-03-01T10:00:00Z");
const IN_TWO_MIN = new Date(NOW.getTime() + LEAD_MS);

function event(over: Record<string, unknown> = {}) {
  return {
    id: "evt1",
    title: "Standup",
    startAt: IN_TWO_MIN,
    reminderCalledFor: null,
    user: { phone: "+14155552671", timezone: "America/New_York" },
    ...over,
  };
}

describe("twilio · TwiML", () => {
  test("escapes the characters that would break the document", () => {
    expect(escapeXml(`1:1 <Ben> & "co" 'x'`)).toBe(
      "1:1 &lt;Ben&gt; &amp; &quot;co&quot; &apos;x&apos;",
    );
  });

  test("an ampersand in an event title survives into valid TwiML", () => {
    // The regression that matters: Twilio rejects the whole call for a stray
    // `&`, so exactly the meetings named "Design & Review" never ring.
    const xml = sayTwiml("Your event, Design & Review, starts soon.");
    expect(xml).toContain("Design &amp; Review");
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  test("says the message twice, because people answer mid-sentence", () => {
    const xml = sayTwiml("Hello");
    expect(xml.match(/<Say/g)).toHaveLength(2);
    expect(xml).toContain("<Pause");
  });
});

describe("twilio · config", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  test("null unless all three values are present", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    delete process.env.TWILIO_FROM_NUMBER;
    expect(twilioConfig()).toBeNull();

    process.env.TWILIO_FROM_NUMBER = "+15005550006";
    expect(twilioConfig()).toEqual({
      accountSid: "AC123", authToken: "tok", fromNumber: "+15005550006",
    });
  });

  test("a whitespace-only value counts as unset", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "   ";
    process.env.TWILIO_FROM_NUMBER = "+15005550006";
    expect(twilioConfig()).toBeNull();
  });
});

describe("reminders · message", () => {
  test("speaks the start time in the user's own timezone", () => {
    const msg = reminderMessage("Standup", new Date("2026-03-01T15:30:00Z"), "America/New_York");
    expect(msg).toContain("Standup");
    expect(msg).toContain("10:30 AM");
  });

  test("falls back rather than throwing on a junk timezone", () => {
    expect(() => reminderMessage("Standup", IN_TWO_MIN, "Not/AZone")).not.toThrow();
  });
});

describe("reminders · sweep", () => {
  const saved = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    findMany.mockReset();
    updateMany.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+15005550006";
    // Required to sign the hosted-TwiML URL; without it placeCall throws.
    process.env.AUTH_SECRET = "test-secret-value";
    delete process.env.TWILIO_TWIML_URL;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ sid: "CA1", status: "queued" }),
    });
    updateMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => { process.env = { ...saved }; vi.unstubAllGlobals(); });

  test("does nothing, loudly enough to log, when Twilio isn't configured", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    const r = await runDueReminders(NOW);
    expect(r.skipped).toBe("no-twilio");
    expect(findMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("only asks for future, timed events belonging to opted-in users", async () => {
    findMany.mockResolvedValue([]);
    await runDueReminders(NOW);
    const where = findMany.mock.calls[0][0].where;
    expect(where.startAt.gt).toEqual(NOW);
    // Lead time plus slack, so a 60s tick can't drag the call late.
    expect(where.startAt.lte.getTime()).toBeGreaterThan(NOW.getTime() + LEAD_MS);
    expect(where.allDay).toBe(false);
    expect(where.user).toEqual({ phone: { not: null }, callReminders: true });
  });

  test("claims the event before dialling", async () => {
    findMany.mockResolvedValue([event()]);
    await runDueReminders(NOW);
    // If this order ever flips, a throw inside placeCall re-dials the phone on
    // every tick until the meeting starts.
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0],
    );
    expect(updateMany.mock.calls[0][0].data).toEqual({ reminderCalledFor: IN_TWO_MIN });
  });

  test("calls the saved number and returns the event", async () => {
    findMany.mockResolvedValue([event()]);
    const r = await runDueReminders(NOW);
    expect(r.called).toEqual(["evt1"]);
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("To")).toBe("+14155552671");
    expect(body.get("From")).toBe("+15005550006");
    expect(body.get("Twiml")).toContain("Standup");
  });

  test("skips an event already called for this start time", async () => {
    findMany.mockResolvedValue([event({ reminderCalledFor: IN_TWO_MIN })]);
    const r = await runDueReminders(NOW);
    expect(r.called).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a rescheduled event earns a fresh call", async () => {
    // Claimed for an older start time — the event moved, so it rings again.
    findMany.mockResolvedValue([
      event({ reminderCalledFor: new Date("2026-02-28T09:00:00Z") }),
    ]);
    const r = await runDueReminders(NOW);
    expect(r.called).toEqual(["evt1"]);
  });

  test("loses the claim race without dialling", async () => {
    findMany.mockResolvedValue([event()]);
    updateMany.mockResolvedValue({ count: 0 });
    const r = await runDueReminders(NOW);
    expect(r.called).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("uses the hosted TwiML URL when configured, packing the message", async () => {
    process.env.TWILIO_TWIML_URL = "https://tunnel.example/api/calls/twiml";
    findMany.mockResolvedValue([event({ title: "Design & Review" })]);

    const r = await runDueReminders(NOW);
    expect(r.called).toEqual(["evt1"]);
    expect(r.generic).toEqual([]);

    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("Twiml")).toBeNull();
    const url = new URL(body.get("Url") as string);
    expect(url.origin + url.pathname).toBe("https://tunnel.example/api/calls/twiml");
    // Packed, so Twilio's URL rewriting cannot truncate it at the ampersand.
    expect(unpack(url.searchParams.get("m") as string)).toContain("Design & Review");
    expect(url.searchParams.get("m")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("preserves an existing query string on the configured URL", async () => {
    process.env.TWILIO_TWIML_URL = "https://tunnel.example/api/calls/twiml?v=2";
    findMany.mockResolvedValue([event()]);
    await runDueReminders(NOW);
    const url = new URL(new URLSearchParams(fetchMock.mock.calls[0][1].body as string).get("Url") as string);
    expect(url.searchParams.get("v")).toBe("2");
    expect(unpack(url.searchParams.get("m") as string)).toContain("Standup");
  });

  test("a failing TwiML URL is a real error, not a reason to ring generically", async () => {
    // Otherwise a deleted bin silently degrades every future call forever.
    process.env.TWILIO_TWIML_URL = "https://tunnel.example/api/calls/twiml";
    findMany.mockResolvedValue([event()]);
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 400,
      text: async () => JSON.stringify({ message: "trial accounts have limited parameter access" }),
    });

    const r = await runDueReminders(NOW);
    expect(r.called).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("falls back to a Twilio template when the account is on a trial", async () => {
    // A trial may not send its own TwiML. Ringing without naming the event is
    // still most of the reminder, so the call goes out anyway.
    findMany.mockResolvedValue([event()]);
    fetchMock
      .mockResolvedValueOnce({
        ok: false, status: 400,
        text: async () => JSON.stringify({
          message: "Invalid or disallowed parameters provided - trial accounts have limited parameter access",
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sid: "CA3", status: "queued" }) });

    const r = await runDueReminders(NOW);
    expect(r.called).toEqual(["evt1"]);
    expect(r.generic).toEqual(["evt1"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const first = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    const second = new URLSearchParams(fetchMock.mock.calls[1][1].body as string);
    expect(first.get("Twiml")).toContain("Standup");
    // The retry drops Twiml entirely — sending both is what Twilio rejected.
    expect(second.get("Twiml")).toBeNull();
    expect(second.get("Url")).toContain("webhooks.twilio.com");
    expect(second.get("To")).toBe("+14155552671");
  });

  test("does NOT retry a 400 that has nothing to do with a trial", async () => {
    // The guard is narrow on purpose: an unverified number or a bad `From`
    // must surface as a failure, not burn a second call on the template URL.
    findMany.mockResolvedValue([event()]);
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 400,
      text: async () => JSON.stringify({ message: "unverified number", code: 21219 }),
    });

    const r = await runDueReminders(NOW);
    expect(r.called).toEqual([]);
    expect(r.generic).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.failed[0].error).toContain("21219");
  });

  test("a full account keeps the spoken message and never retries", async () => {
    findMany.mockResolvedValue([event()]);
    const r = await runDueReminders(NOW);
    expect(r.called).toEqual(["evt1"]);
    expect(r.generic).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a Twilio failure is reported, and does not stop the next event", async () => {
    findMany.mockResolvedValue([event(), event({ id: "evt2", title: "Retro" })]);
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => JSON.stringify({ message: "unverified", code: 21219 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sid: "CA2", status: "queued" }) });

    const r = await runDueReminders(NOW);
    expect(r.called).toEqual(["evt2"]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatchObject({ eventId: "evt1" });
    expect(r.failed[0].error).toContain("unverified");
    expect(r.failed[0].error).toContain("21219");
  });
});

describe("phone validation", () => {
  test("accepts E.164 and rejects the shapes people actually type", async () => {
    const { phoneZ } = await import("../validation");
    for (const ok of ["+14155552671", "+919876543210", "+442071838750"]) {
      expect(phoneZ.safeParse(ok).success).toBe(true);
    }
    for (const bad of [
      "4155552671",        // no country code — dials nowhere
      "+0155552671",       // country codes never start with 0
      "(415) 555-2671",
      "+1415555267100000", // too long for E.164
      "+1234",             // too short
      "",
    ]) {
      expect(phoneZ.safeParse(bad).success, bad).toBe(false);
    }
  });

  test("trims surrounding whitespace rather than failing on it", async () => {
    const { phoneZ } = await import("../validation");
    expect(phoneZ.parse("  +14155552671 ")).toBe("+14155552671");
  });
});
