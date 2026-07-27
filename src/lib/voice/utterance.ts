/**
 * Utterance boundary detection — the "assistant knows you've finished" part.
 *
 * Deliberately a pure state machine over (level, timestamp) rather than
 * something wired into an AudioContext, so the tricky part — the timing rules —
 * is testable without a microphone.
 *
 * The rules that matter:
 *  - A short spike (a door, a keystroke) must not open an utterance. So speech
 *    has to persist for `speechMs` before we commit.
 *  - A natural pause mid-sentence must not close one. So silence has to persist
 *    for `silenceMs`, which is longer than any comma-pause.
 *  - Hysteresis: the level to *start* speech is higher than the level to
 *    *sustain* it, so breathing at the threshold doesn't flap the state.
 */

export interface UtteranceOptions {
  /** RMS (0–1) that counts as speech starting. */
  startLevel: number;
  /** RMS (0–1) below which we consider the speaker silent. */
  endLevel: number;
  /** Speech must persist this long before an utterance opens. */
  speechMs: number;
  /** Silence must persist this long before an utterance closes. */
  silenceMs: number;
  /** Hard cap so a noisy room can't record forever. */
  maxUtteranceMs: number;
}

export const DEFAULT_UTTERANCE_OPTIONS: UtteranceOptions = {
  startLevel: 0.055,
  endLevel: 0.03,
  speechMs: 140,
  // ~1s is the sweet spot: long enough to survive "um…", short enough that the
  // assistant doesn't feel asleep.
  silenceMs: 1000,
  maxUtteranceMs: 30_000,
};

export type UtteranceEvent =
  /** Speech confirmed — begin capturing. */
  | { type: "start" }
  /** Silence (or the cap) ended the utterance. */
  | { type: "end"; reason: "silence" | "max-duration"; durationMs: number }
  /** Nothing changed. */
  | null;

type Phase = "idle" | "maybe-speech" | "speaking" | "maybe-done";

export class UtteranceDetector {
  private phase: Phase = "idle";
  private phaseSince = 0;
  private startedAt = 0;
  private readonly o: UtteranceOptions;

  constructor(options: Partial<UtteranceOptions> = {}) {
    this.o = { ...DEFAULT_UTTERANCE_OPTIONS, ...options };
  }

  /** True while an utterance is open (capturing audio). */
  get active(): boolean {
    return this.phase === "speaking" || this.phase === "maybe-done";
  }

  /** Feed one level sample. `now` is a monotonic ms clock. */
  push(level: number, now: number): UtteranceEvent {
    switch (this.phase) {
      case "idle":
        if (level >= this.o.startLevel) this.to("maybe-speech", now);
        return null;

      case "maybe-speech":
        if (level < this.o.endLevel) {
          // Too brief to be speech — a click or a bump.
          this.to("idle", now);
          return null;
        }
        if (now - this.phaseSince >= this.o.speechMs) {
          this.to("speaking", now);
          this.startedAt = now;
          return { type: "start" };
        }
        return null;

      case "speaking":
        if (now - this.startedAt >= this.o.maxUtteranceMs) {
          return this.close(now, "max-duration");
        }
        if (level < this.o.endLevel) this.to("maybe-done", now);
        return null;

      case "maybe-done":
        if (level >= this.o.startLevel) {
          // Just a pause — they're still talking.
          this.to("speaking", now);
          return null;
        }
        if (now - this.startedAt >= this.o.maxUtteranceMs) {
          return this.close(now, "max-duration");
        }
        if (now - this.phaseSince >= this.o.silenceMs) {
          return this.close(now, "silence");
        }
        return null;
    }
  }

  /** Force the current utterance closed (e.g. the user exits voice mode). */
  flush(now: number): UtteranceEvent {
    if (!this.active) {
      this.to("idle", now);
      return null;
    }
    return this.close(now, "silence");
  }

  reset() {
    this.phase = "idle";
    this.phaseSince = 0;
    this.startedAt = 0;
  }

  private close(now: number, reason: "silence" | "max-duration"): UtteranceEvent {
    const durationMs = now - this.startedAt;
    this.to("idle", now);
    return { type: "end", reason, durationMs };
  }

  private to(phase: Phase, now: number) {
    this.phase = phase;
    this.phaseSince = now;
  }
}

/**
 * Whisper hallucinates stock phrases when handed near-silence — "Thank you for
 * watching", "I hope you enjoyed this video", subtitle credits. In hands-free
 * mode nobody is there to delete them, so they'd be silently filed as tasks.
 */
const HALLUCINATIONS = [
  /^thank(s| you)( (so|very) much)?( for watching)?[.!]?$/i,
  /^i hope you (enjoyed|liked) (this|the) video[.!]?$/i,
  /^(please )?(like|subscribe)( and subscribe)?[.!]?$/i,
  /^(subtitles?|captions?|transcription) by .*/i,
  /^(amara\.org|www\.|http)/i,
  /^\[?\s*(music|silence|applause|laughter|inaudible|blank_audio)\s*\]?[.!]?$/i,
  /^(bye|okay|ok|uh|um|hmm|mm|ah|oh|yeah|so)[.!]?$/i,
];

/**
 * Is this transcript worth acting on? Rejects empties, punctuation-only strings,
 * single filler words, and Whisper's silence artefacts.
 */
export function isUsableTranscript(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return false;
  // Strip surrounding punctuation before matching.
  const core = t.replace(/^["'\s]+|["'\s]+$/g, "");
  if (!/[a-z0-9ऀ-ॿ]/i.test(core)) return false; // no letters/digits at all
  if (HALLUCINATIONS.some((re) => re.test(core))) return false;

  const sentences = core.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);

  // Whisper strings its stock phrases together on silence — an observed one was
  // "Thank you for watching. Please subscribe. Thank you. Bye. Bye.", which
  // slipped past a whole-string check and got filed as a task called
  // "Subscribe". If every sentence is boilerplate, the whole thing is.
  if (sentences.length > 1 && sentences.every((s) => HALLUCINATIONS.some((re) => re.test(s)))) {
    return false;
  }

  // A lone repeated phrase is the other classic silence artefact.
  if (sentences.length >= 3 && new Set(sentences).size === 1) return false;
  return true;
}


/**
 * Phrases that end the session — "that'll be all", "stop listening", "thanks,
 * that's it".
 *
 * Matched against the *whole* utterance, never a substring: "that'll be all I
 * need from the shop" is a shopping list, not a sign-off. Whisper's punctuation
 * and capitalisation vary, so both are normalised away first.
 */
const STOP_PHRASES = [
  /^that('?ll| will)? be all$/,
  /^that'?s (it|all|everything)$/,
  /^(ok(ay)?|alright|right)?,? ?that'?s (it|all)( for now)?$/,
  /^(stop|quit|exit|end) (listening|recording|voice( mode)?)$/,
  /^stop listening to me$/,
  /^(i'?m|we'?re) (done|finished)( now)?$/,
  /^(thanks|thank you),? that'?s (it|all)$/,
  /^(goodbye|bye|good ?night)$/,
  /^nothing else$/,
  /^no more$/,
];

/**
 * Should this utterance end voice mode instead of being executed?
 *
 * Returns false for anything that merely contains a sign-off, so a real
 * instruction is never swallowed.
 */
function normalizeForStop(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")     // smart quotes → plain
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isStopPhrase(text: string): boolean {
  const t = normalizeForStop(text);
  if (!t) return false;
  if (STOP_PHRASES.some((re) => re.test(t))) return true;

  // People sign off in more than one breath — "Okay, that's it. That will be
  // all." arrives as one utterance with two sentences. Every sentence must be a
  // sign-off, so "That's it. Also remind me to call Sam" still runs.
  const sentences = text.split(/[.!?]+/).map(normalizeForStop).filter(Boolean);
  if (sentences.length > 1 && sentences.every((s) => STOP_PHRASES.some((re) => re.test(s)))) {
    return true;
  }
  return false;
}
