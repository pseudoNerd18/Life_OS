import { describe, test, expect } from "vitest";
import { applyReplacement } from "../server/actions";

describe("in-place text correction", () => {
  test("replaces the first occurrence, preserving the rest", () => {
    expect(
      applyReplacement("no regrets is a nice teacher idea", "teacher idea", "t-shirt idea"),
    ).toBe("no regrets is a nice t-shirt idea");
  });
  test("is case-insensitive but keeps the replacement's own case", () => {
    expect(applyReplacement("Call the Dentist", "dentist", "doctor")).toBe("Call the doctor");
  });
  test("returns null when the text isn't there, so we can say so", () => {
    expect(applyReplacement("hello world", "banana", "apple")).toBe(null);
  });
});
