import { describe, test, expect } from "vitest";
import { scoreMatch } from "../server/resolve";

describe("target scoring (which item did they mean?)", () => {
  test("an exact title beats everything", () => {
    expect(scoreMatch("gym", "gym")).toBe(100);
  });
  test("a title containing the phrase scores high", () => {
    expect(scoreMatch("dentist", "Call the dentist") >= 80).toBeTruthy();
  });
  test("a title match outranks a body-only match", () => {
    const title = scoreMatch("roof", "Fix the roof", "unrelated body");
    const body = scoreMatch("roof", "Weekly review", "the roof needs fixing");
    expect(title > body).toBeTruthy();
  });
  test("unrelated items score zero", () => {
    expect(scoreMatch("dentist", "Buy milk")).toBe(0);
  });
  test("filler words alone don't match everything", () => {
    // "the task" is all stopwords — it must not confidently select a random row.
    expect(scoreMatch("the task", "Buy milk")).toBe(0);
  });
  test("partial token overlap scores in between", () => {
    const sc = scoreMatch("gym session", "Gym", "");
    expect(sc > 0 && sc < 80).toBeTruthy();
  });
});
