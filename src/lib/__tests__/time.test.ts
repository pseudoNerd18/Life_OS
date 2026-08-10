import { describe, test, expect } from "vitest";
import * as chrono from "chrono-node";
import { dayRangeIn, dateKeyIn, hourIn, safeTz, parseDateInTz } from "../time";

/** Wall-clock rendering of an instant in a zone, as "YYYY-MM-DD HH:mm". */
function wall(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}

describe("safeTz", () => {
  test("passes a valid zone through", () => expect(safeTz("Asia/Kolkata")).toBe("Asia/Kolkata"));
  test("falls back to UTC on garbage", () => expect(safeTz("Not/AZone")).toBe("UTC"));
  test("falls back to UTC on null", () => expect(safeTz(null)).toBe("UTC"));
});

describe("dayRangeIn", () => {
  for (const tz of ["Asia/Kolkata", "America/Los_Angeles", "Europe/London", "Pacific/Kiritimati", "UTC"]) {
    test(`${tz}: day starts at local midnight`, () => {
      const { start, end } = dayRangeIn(tz);
      expect(wall(start, tz).slice(-5)).toBe("00:00");
      expect(end.getTime() - start.getTime()).toBe(86_400_000);
    });
    test(`${tz}: now falls inside today`, () => {
      const { start, end } = dayRangeIn(tz);
      const now = Date.now();
      expect(now >= start.getTime() && now < end.getTime()).toBeTruthy();
    });
  }
});

describe("dateKeyIn", () => {
  test("key is UTC midnight of the user's calendar day", () => {
    for (const tz of ["Asia/Kolkata", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      const key = dateKeyIn(tz);
      expect(key.toISOString().slice(10)).toBe("T00:00:00.000Z");
      const expected = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
      expect(key.toISOString().slice(0, 10)).toBe(expected);
    }
  });
  test("UTC+14 and UTC-7 can disagree on the date", () => {
    // Not always true, but when it is, the keys must differ — this is the class
    // of bug that made DailyBriefing.forDate drift.
    const a = dateKeyIn("Pacific/Kiritimati").toISOString().slice(0, 10);
    const b = dateKeyIn("America/Los_Angeles").toISOString().slice(0, 10);
    const expectedA = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati" }).format(new Date());
    const expectedB = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
    expect(a).toBe(expectedA);
    expect(b).toBe(expectedB);
  });
});

describe("hourIn", () => {
  test("returns 0-23", () => {
    for (const tz of ["Asia/Kolkata", "UTC", "America/New_York"]) {
      const h = hourIn(tz);
      expect(Number.isInteger(h) && h >= 0 && h <= 23).toBeTruthy();
    }
  });
});

describe("parseDateInTz", () => {
  const parse = (t: string, r: Date) => chrono.parseDate(t, r, { forwardDate: true });
  test("'tomorrow at 7pm' is 19:00 in every zone", () => {
    for (const tz of ["Asia/Kolkata", "America/Los_Angeles", "Europe/London", "Pacific/Kiritimati", "UTC"]) {
      const d = parseDateInTz(parse, "tomorrow at 7pm", tz);
      expect(d).toBeTruthy();
      expect(wall(d!, tz).slice(-5)).toBe("19:00");
    }
  });
  test("'tomorrow' lands on the day after the user's today", () => {
    for (const tz of ["Asia/Kolkata", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      const d = parseDateInTz(parse, "tomorrow at noon", tz)!;
      const today = dateKeyIn(tz);
      const got = wall(d, tz).slice(0, 10);
      const want = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);
      expect(got).toBe(want);
    }
  });
  test("returns null when there is no date in the text", () => {
    expect(parseDateInTz(parse, "fix the leaking tap", "Asia/Kolkata")).toBe(null);
  });
});
