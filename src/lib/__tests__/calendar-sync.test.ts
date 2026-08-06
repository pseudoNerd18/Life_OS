import { describe, test, expect } from "vitest";
import { decide, eventSpan, spanMinutes, taskSpan } from "../calendar/reconcile";

const T0 = new Date("2026-03-01T10:00:00Z");
const EARLIER = new Date("2026-03-01T09:00:00Z");
const LATER = new Date("2026-03-01T11:00:00Z");
const LATEST = new Date("2026-03-01T12:00:00Z");

describe("calendar sync · decide()", () => {
  test("never synced → push", () => {
    const d = decide({ localUpdatedAt: EARLIER, remoteUpdatedAt: null, agreedAt: null });
    expect(d.direction).toBe("push");
    expect(d.conflict).toBe(false);
  });
  test("neither side moved → noop", () => {
    const d = decide({ localUpdatedAt: EARLIER, remoteUpdatedAt: EARLIER, agreedAt: T0 });
    expect(d.direction).toBe("noop");
  });
  test("only the task moved → push", () => {
    const d = decide({ localUpdatedAt: LATER, remoteUpdatedAt: EARLIER, agreedAt: T0 });
    expect(d.direction).toBe("push");
    expect(d.conflict).toBe(false);
  });
  test("only Google moved → pull", () => {
    const d = decide({ localUpdatedAt: EARLIER, remoteUpdatedAt: LATER, agreedAt: T0 });
    expect(d.direction).toBe("pull");
    expect(d.conflict).toBe(false);
  });
  test("both moved, Google later → pull, flagged as a conflict", () => {
    const d = decide({ localUpdatedAt: LATER, remoteUpdatedAt: LATEST, agreedAt: T0 });
    expect(d.direction).toBe("pull");
    expect(d.conflict).toBe(true);
  });
  test("both moved, task later → push, flagged as a conflict", () => {
    const d = decide({ localUpdatedAt: LATEST, remoteUpdatedAt: LATER, agreedAt: T0 });
    expect(d.direction).toBe("push");
    expect(d.conflict).toBe(true);
  });
  test("an exact tie goes to Google, not to us", () => {
    const d = decide({ localUpdatedAt: LATER, remoteUpdatedAt: LATER, agreedAt: T0 });
    expect(d.direction).toBe("pull");
    expect(d.conflict).toBe(true);
  });
  test("a remote timestamp equal to the agreement is not a change", () => {
    const d = decide({ localUpdatedAt: LATER, remoteUpdatedAt: T0, agreedAt: T0 });
    expect(d.direction).toBe("push");
    expect(d.conflict).toBe(false);
  });
});

describe("calendar sync · taskSpan()", () => {
  test("an unscheduled task has no span", () => {
    expect(taskSpan({ startAt: null, dueAt: null, durationMin: 60 })).toBe(null);
  });
  test("startAt wins over dueAt", () => {
    const s = taskSpan({ startAt: T0, dueAt: LATEST, durationMin: 15 })!;
    expect(s.start.toISOString()).toBe(T0.toISOString());
  });
  test("dueAt is used when there is no startAt", () => {
    const s = taskSpan({ startAt: null, dueAt: T0, durationMin: 15 })!;
    expect(s.start.toISOString()).toBe(T0.toISOString());
    expect(spanMinutes(s)).toBe(15);
  });
  test("a missing duration falls back to 30 minutes", () => {
    expect(spanMinutes(taskSpan({ startAt: T0, dueAt: null, durationMin: null })!)).toBe(30);
  });
  test("a zero or negative duration does not collapse the event", () => {
    expect(spanMinutes(taskSpan({ startAt: T0, dueAt: null, durationMin: 0 })!)).toBe(30);
    expect(spanMinutes(taskSpan({ startAt: T0, dueAt: null, durationMin: -5 })!)).toBe(30);
  });
});

describe("calendar sync · eventSpan()", () => {
  test("a timed event keeps its own end", () => {
    const s = eventSpan({
      start: { dateTime: "2026-03-01T10:00:00Z" },
      end: { dateTime: "2026-03-01T11:30:00Z" },
    })!;
    expect(spanMinutes(s)).toBe(90);
    expect(s.allDay).toBe(false);
  });
  test("a date-only event is all-day and one day long", () => {
    const s = eventSpan({ start: { date: "2026-03-01" }, end: { date: "2026-03-02" } })!;
    expect(s.allDay).toBe(true);
    expect(spanMinutes(s)).toBe(1440);
  });
  test("an event with no end gets an hour", () => {
    const s = eventSpan({ start: { dateTime: "2026-03-01T10:00:00Z" } })!;
    expect(spanMinutes(s)).toBe(60);
  });
  test("an all-day event with no end gets a day, not an hour", () => {
    const s = eventSpan({ start: { date: "2026-03-01" } })!;
    expect(spanMinutes(s)).toBe(1440);
  });
  test("an inverted end is repaired instead of going negative", () => {
    const s = eventSpan({
      start: { dateTime: "2026-03-01T10:00:00Z" },
      end: { dateTime: "2026-03-01T09:00:00Z" },
    })!;
    expect(s.end > s.start).toBeTruthy();
    expect(spanMinutes(s)).toBe(60);
  });
  test("a malformed end is repaired", () => {
    const s = eventSpan({
      start: { dateTime: "2026-03-01T10:00:00Z" },
      end: { dateTime: "not-a-date" },
    })!;
    expect(spanMinutes(s)).toBe(60);
  });
  test("an event with no start is skipped", () => {
    expect(eventSpan({ end: { dateTime: "2026-03-01T10:00:00Z" } })).toBe(null);
    expect(eventSpan({ start: { dateTime: "garbage" } })).toBe(null);
  });
});
