import { describe, test, expect } from "vitest";
import { UtteranceDetector, DEFAULT_UTTERANCE_OPTIONS } from "../voice/utterance";
import type { UtteranceEvent } from "../voice/utterance";

/**
 * Narrow an event to the "end" variant before reading `reason`/`durationMs`.
 * Those fields only exist on that variant, so the union has to be discriminated
 * before access or the file doesn't typecheck.
 */
function asEnd(ev: NonNullable<UtteranceEvent> | undefined) {
  if (!ev || ev.type !== "end") throw new Error(`expected an "end" event, got ${ev?.type ?? "none"}`);
  return ev;
}

describe("utterance detection (hands-free cue)", () => {
  const O = DEFAULT_UTTERANCE_OPTIONS;
  const LOUD = O.startLevel + 0.05;
  const QUIET = 0.001;

  /** Feed a level for `ms`, collecting any events. Samples every 16ms (~60fps). */
  function feed(d: UtteranceDetector, level: number, ms: number, t: { now: number }) {
    const events = [];
    const end = t.now + ms;
    while (t.now < end) {
      const ev = d.push(level, t.now);
      if (ev) events.push(ev);
      t.now += 16;
    }
    return events;
  }

  test("silence alone never opens an utterance", () => {
    const d = new UtteranceDetector(); const t = { now: 0 };
    expect(feed(d, QUIET, 5000, t)).toEqual([]);
    expect(d.active).toBe(false);
  });

  test("sustained speech opens exactly one utterance", () => {
    const d = new UtteranceDetector(); const t = { now: 0 };
    const evs = feed(d, LOUD, 1000, t);
    expect(evs.length).toBe(1);
    expect(evs[0].type).toBe("start");
    expect(d.active).toBe(true);
  });

  test("a brief spike is rejected — a door slam is not a sentence", () => {
    const d = new UtteranceDetector(); const t = { now: 0 };
    const evs = [...feed(d, LOUD, 60, t), ...feed(d, QUIET, 2000, t)];
    expect(evs).toEqual([]);
    expect(d.active).toBe(false);
  });

  test("a pause mid-sentence does NOT end the utterance", () => {
    const d = new UtteranceDetector(); const t = { now: 0 };
    feed(d, LOUD, 500, t);                       // "remind me to..."
    const during = feed(d, QUIET, O.silenceMs - 250, t);   // "...um..."
    expect(during).toEqual([]);
    const after = feed(d, LOUD, 500, t);         // "...call the dentist"
    expect(after).toEqual([]);
    expect(d.active).toBe(true);
  });

  test("a long enough pause ends it — this is the cue to act", () => {
    const d = new UtteranceDetector(); const t = { now: 0 };
    feed(d, LOUD, 800, t);
    const evs = feed(d, QUIET, O.silenceMs + 200, t);
    expect(evs.length).toBe(1);
    expect(evs[0].type).toBe("end");
    expect(asEnd(evs[0]).reason).toBe("silence");
    expect(d.active).toBe(false);
  });

  test("speaking again after a completed utterance starts a new one", () => {
    const d = new UtteranceDetector(); const t = { now: 0 };
    feed(d, LOUD, 600, t);
    feed(d, QUIET, O.silenceMs + 100, t);        // ends #1
    const evs = feed(d, LOUD, 600, t);
    expect(evs.length).toBe(1);
    expect(evs[0].type).toBe("start");
  });

  test("continuous speech is capped and segmented, never dropped", () => {
    const d = new UtteranceDetector(); const t = { now: 0 };
    const evs = feed(d, LOUD, O.maxUtteranceMs + 1000, t);
    expect(evs[0].type).toBe("start");
    expect(evs[1].type).toBe("end");
    expect(asEnd(evs[1]).reason).toBe("max-duration");
    expect(asEnd(evs[1]).durationMs >= O.maxUtteranceMs).toBeTruthy();
    // A monologue past the cap must reopen, so the tail isn't thrown away.
    expect(evs[2]?.type).toBe("start");
  });

  test("reported duration covers the whole utterance", () => {
    const d = new UtteranceDetector(); const t = { now: 0 };
    feed(d, LOUD, 2000, t);
    const evs = feed(d, QUIET, O.silenceMs + 100, t);
    const ev = evs[0];
    expect(ev.type).toBe("end");
    expect(asEnd(ev).durationMs >= 2000).toBeTruthy();
  });

  test("hysteresis: a level between end and start thresholds sustains speech", () => {
    const d = new UtteranceDetector(); const t = { now: 0 };
    feed(d, LOUD, 500, t);
    // Between endLevel and startLevel — quiet, but not silent.
    const mid = (O.endLevel + O.startLevel) / 2;
    const evs = feed(d, mid, 3000, t);
    expect(evs).toEqual([]);
    expect(d.active).toBe(true);
  });

  test("flush() closes an open utterance and is safe when idle", () => {
    const d = new UtteranceDetector(); const t = { now: 0 };
    expect(d.flush(t.now)).toBe(null);
    feed(d, LOUD, 500, t);
    const ev = d.flush(t.now);
    expect(ev?.type).toBe("end");
    expect(d.active).toBe(false);
  });
});
