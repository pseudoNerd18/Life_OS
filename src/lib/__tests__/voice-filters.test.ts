import { describe, test, expect } from "vitest";
import { isUsableTranscript, isStopPhrase } from "../voice/utterance";

describe("transcript usability filter", () => {
  test("real requests pass", () => {
    for (const t of [
      "Remind me to call the dentist tomorrow at 3pm",
      "Set a note saying no regrets is a nice t-shirt idea",
      "Take vitamin B12 every 3 days",
      "Pay rent",
    ]) expect(isUsableTranscript(t)).toBe(true);
  });
  test("Whisper's silence hallucinations are rejected", () => {
    // Every one of these was actually produced by the local model on near-silence.
    for (const t of [
      "Thank you for watching.",
      "I hope you enjoyed this video.",
      "Thanks for watching!",
      "Please like and subscribe",
      "Subtitles by the Amara.org community",
      "[BLANK_AUDIO]",
      "[Music]",
      "I hope you enjoyed this video. I hope you enjoyed this video. I hope you enjoyed this video.",
    ]) expect(isUsableTranscript(t)).toBe(false);
  });
  test("a string of stock phrases is rejected as a whole", () => {
    // Observed verbatim from the local model on a near-silent clip; the previous
    // whole-string check passed it through and it became a task called "Subscribe".
    for (const t of [
      "Thank you for watching. Please subscribe. Thank you. Bye. Bye.",
      "Thanks for watching! Please like and subscribe.",
      "Bye. Bye. Bye.",
      "[Music] [Applause]".replace(/\] \[/, "]. ["),
    ]) expect(isUsableTranscript(t)).toBe(false);
  });
  test("a real request that merely ends politely still passes", () => {
    expect(isUsableTranscript("Remind me to call the dentist. Thanks.")).toBe(true);
  });
  test("empties, punctuation and lone fillers are rejected", () => {
    for (const t of ["", "   ", ".", "...", "?!", "um", "Okay.", "uh"])
      expect(isUsableTranscript(t)).toBe(false);
  });
  test("a short but real instruction still passes", () => {
    expect(isUsableTranscript("Buy milk")).toBe(true);
  });
});

describe("stop phrase (\"that'll be all\")", () => {
  test("sign-offs end the session", () => {
    for (const t of [
      "That'll be all", "That'll be all.", "that will be all",
      "That's it", "That's all", "Okay, that's it",
      "Stop listening", "stop recording", "Exit voice mode",
      "I'm done", "We're finished", "Thanks, that's all",
      "Goodbye", "Nothing else", "no more",
      "That’ll be all",   // smart apostrophe, which is what Whisper emits
    ]) expect(isStopPhrase(t)).toBe(true);
  });
  test("a multi-sentence sign-off stops", () => {
    // What Whisper actually returned for a spoken sign-off.
    for (const t of [
      "Okay, that's it. That will be all.",
      "That's it. Goodbye.",
      "I'm done. Thanks, that's all.",
    ]) expect(isStopPhrase(t)).toBe(true);
  });
  test("a sign-off followed by a real instruction does NOT stop", () => {
    for (const t of [
      "That's it. Also remind me to call Sam.",
      "Okay that's all. Add milk to the list.",
    ]) expect(isStopPhrase(t)).toBe(false);
  });
  test("a sign-off buried in a real instruction does NOT stop", () => {
    for (const t of [
      "That'll be all I need from the shop",
      "Add a note that says that's it for the quarter",
      "Remind me that's all the budget we have",
      "Stop listening to podcasts every night",
      "Buy milk",
    ]) expect(isStopPhrase(t)).toBe(false);
  });
});
