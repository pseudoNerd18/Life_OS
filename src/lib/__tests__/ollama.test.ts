import { describe, test, expect } from "vitest";
import { modelMatches } from "../ai/ollama";

describe("modelMatches", () => {
  test("an exact name matches", () => {
    expect(modelMatches("gemma3:4b", "gemma3:4b")).toBe(true);
  });
  test("a bare name implies :latest on both sides", () => {
    expect(modelMatches("gemma3:latest", "gemma3")).toBe(true);
    expect(modelMatches("gemma3", "gemma3:latest")).toBe(true);
    expect(modelMatches("nomic-embed-text:latest", "nomic-embed-text")).toBe(true);
  });
  test("a different tag of the same family does NOT match", () => {
    // The bug this replaced: startsWith("gemma3") reported gemma3:4b as installed
    // when only gemma3:1b was pulled.
    expect(modelMatches("gemma3:1b", "gemma3:4b")).toBe(false);
    expect(modelMatches("gemma3:1b", "gemma3")).toBe(false);
  });
  test("different families do not match", () => {
    expect(modelMatches("llama3.2:latest", "gemma3")).toBe(false);
  });
});
