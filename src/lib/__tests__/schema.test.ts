import { describe, test, expect } from "vitest";
import { normalizeRRule, modelCategoryZ, modelPriorityZ, modelDateZ, modelDurationZ } from "../ai/schema";

describe("normalizeRRule", () => {
  test("passes a valid rule through", () => {
    expect(normalizeRRule("FREQ=DAILY;INTERVAL=3")).toBe("FREQ=DAILY;INTERVAL=3");
    expect(normalizeRRule("FREQ=WEEKLY;BYDAY=TU,TH")).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
  });
  test("strips an RRULE: prefix", () => {
    expect(normalizeRRule("RRULE:FREQ=WEEKLY")).toBe("FREQ=WEEKLY");
    expect(normalizeRRule("RRULE: FREQ=MONTHLY;INTERVAL=2")).toBe("FREQ=MONTHLY;INTERVAL=2");
  });
  test("accepts commas used as pair separators", () => {
    expect(normalizeRRule("FREQ=DAILY,INTERVAL=2")).toBe("FREQ=DAILY;INTERVAL=2");
  });
  test("keeps commas inside a value", () => {
    expect(normalizeRRule("FREQ=WEEKLY,BYDAY=MO,WE,FR")).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  });
  test("uppercases and reorders FREQ first", () => {
    expect(normalizeRRule("interval=2;freq=weekly")).toBe("FREQ=WEEKLY;INTERVAL=2");
  });
  test("rejects an unrecoverable FREQ rather than guessing", () => {
    // The real observed failure: "RRULE: FREQ=3,INTERVAL=3".
    expect(normalizeRRule("RRULE: FREQ=3,INTERVAL=3")).toBe(null);
    expect(normalizeRRule("FREQ=FORTNIGHTLY")).toBe(null);
  });
  test("rejects a rule with no FREQ", () => {
    expect(normalizeRRule("INTERVAL=2;BYDAY=MO")).toBe(null);
  });
  test("drops a nonsense INTERVAL but keeps the rule", () => {
    expect(normalizeRRule("FREQ=DAILY;INTERVAL=zero")).toBe("FREQ=DAILY");
    expect(normalizeRRule("FREQ=DAILY;INTERVAL=0")).toBe("FREQ=DAILY");
  });
  test("non-strings and junk become null", () => {
    for (const v of [null, undefined, 42, "", "   ", "every 3 days", {}]) {
      expect(normalizeRRule(v)).toBe(null);
    }
  });
});

describe("model value coercion", () => {
  test("invented categories map to the closest real one", () => {
    expect(modelCategoryZ.parse("LANGUAGE")).toBe("LEARNING");
    expect(modelCategoryZ.parse("SELF-REFLECTION")).toBe("PERSONAL");
    expect(modelCategoryZ.parse("fitness")).toBe("HEALTH");
    expect(modelCategoryZ.parse("Career")).toBe("WORK");
  });
  test("unknown categories fall back to OTHER, not an error", () => {
    expect(modelCategoryZ.parse("INTERPRETIVE DANCE")).toBe("OTHER");
    expect(modelCategoryZ.parse(undefined)).toBe("OTHER");
    expect(modelCategoryZ.parse(7)).toBe("OTHER");
  });
  test("real categories survive unchanged", () => {
    for (const c of ["WORK", "HEALTH", "FINANCE", "OTHER"]) {
      expect(modelCategoryZ.parse(c)).toBe(c);
    }
  });
  test("priorities coerce, defaulting to MEDIUM", () => {
    expect(modelPriorityZ.parse("high")).toBe("HIGH");
    expect(modelPriorityZ.parse("CRITICAL")).toBe("URGENT");
    expect(modelPriorityZ.parse("normal")).toBe("MEDIUM");
    expect(modelPriorityZ.parse("banana")).toBe("MEDIUM");
    expect(modelPriorityZ.parse(undefined)).toBe("MEDIUM");
  });
  test("date-only strings become ISO instants", () => {
    expect(modelDateZ.parse("2026-09-27")).toBe("2026-09-27T00:00:00.000Z");
    expect(modelDateZ.parse("2026-09-27T10:00:00.000Z")).toBe("2026-09-27T10:00:00.000Z");
  });
  test("unparseable dates become null, not an error", () => {
    for (const v of ["next Tuesday-ish", "", null, undefined, 0, "2026-99-99"]) {
      expect(modelDateZ.parse(v)).toBe(null);
    }
  });
  test("durations coerce to positive integers or null", () => {
    expect(modelDurationZ.parse("60")).toBe(60);
    expect(modelDurationZ.parse(60.6)).toBe(61);
    expect(modelDurationZ.parse(-5)).toBe(null);
    expect(modelDurationZ.parse("soon")).toBe(null);
    expect(modelDurationZ.parse(undefined)).toBe(null);
  });
});
