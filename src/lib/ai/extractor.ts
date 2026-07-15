import * as chrono from "chrono-node";
import { ollamaChat } from "./ollama";
import { INTENT_EXTRACTION_SYSTEM, intentExtractionPrompt } from "./prompts";
import { extractedIntentZ, type ExtractedIntent } from "@/lib/validation";
import { deterministicExtract, recurrenceOf } from "./fallback-parser";
import { getCapabilities } from "@/lib/env";
import { parseDateInTz, safeTz } from "@/lib/time";

interface ExtractCtx {
  timezone: string;
  now?: Date;
}

/** Parses a model's raw text into a schema-valid intent, or null if it can't. */
function parseModelOutput(raw: string): ExtractedIntent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  const safe = extractedIntentZ.safeParse(parsed);
  return safe.success ? safe.data : null;
}

/**
 * Intent extraction with graceful degradation.
 *
 * 1. If Ollama isn't configured → deterministic parser immediately.
 * 2. If Ollama IS configured but the call fails or returns garbage → fall
 *    back to the deterministic parser rather than erroring.
 * 3. Otherwise → Gemma's structured output, with chrono-node date validation.
 *
 * The caller always gets a valid ExtractedIntent. It never throws.
 */
export async function extractIntent(input: string, ctx: ExtractCtx): Promise<ExtractedIntent> {
  const caps = getCapabilities();

  if (!caps.hasOllama) {
    return deterministicExtract(input, ctx.timezone);
  }

  const now = ctx.now ?? new Date();
  // Minute precision on purpose. With seconds present, a small model that
  // echoes this string back verbatim produces a dueAt that *looks* computed
  // (18:25:26) and is impossible to distinguish from a real answer.
  const nowLocal = now
    .toLocaleString("sv-SE", { timeZone: ctx.timezone })
    .replace(" ", "T")
    .slice(0, 16);
  // Spelling out today/tomorrow removes the one bit of arithmetic a 1B model
  // reliably gets wrong, and gives rule 1a a concrete anchor to reference.
  const civil = (at: Date) =>
    at.toLocaleDateString("en-CA", { timeZone: ctx.timezone });
  const today = civil(now);
  const tomorrow = civil(new Date(now.getTime() + 86_400_000));

  let raw: string;
  try {
    raw = await ollamaChat({
      system: INTENT_EXTRACTION_SYSTEM,
      prompt: intentExtractionPrompt(input, {
        now: nowLocal, tz: ctx.timezone, today, tomorrow,
      }),
      format: "json",
      temperature: 0.1,
    });
  } catch (err) {
    console.warn("[extractor] Ollama call failed, using fallback parser:", (err as Error).message);
    return deterministicExtract(input, ctx.timezone);
  }

  const data = parseModelOutput(raw);
  if (!data) {
    console.warn("[extractor] schema mismatch, using fallback parser");
    return deterministicExtract(input, ctx.timezone);
  }

  return reconcile(input, ctx, data);
}

/**
 * Reconciles the model's extraction against the deterministic keyword parser.
 *
 * The two are good at different things. The model reads intent and writes
 * clean titles; the regex rules never miss an explicit verb, date, or the
 * word "note". Small models in particular filed "the previous note should say
 * X not Y" as a brand-new task — creating a duplicate instead of editing, the
 * single worst failure mode here because it silently multiplies data.
 */
function reconcile(input: string, ctx: ExtractCtx, data: ExtractedIntent): ExtractedIntent {
  const now = ctx.now ?? new Date();
  const det = deterministicExtract(input, ctx.timezone);
  const ACT = ["UPDATE", "DELETE", "COMPLETE"] as const;
  const detActs = (ACT as readonly string[]).includes(det.intent);
  const modelActs = (ACT as readonly string[]).includes(data.intent);

  if (detActs && !modelActs) {
    // The utterance plainly says delete/finish/change and the model missed it.
    // Acting on the wrong verb creates junk; trust the explicit words.
    console.warn(`[extractor] model said ${data.intent}, utterance says ${det.intent} — using ${det.intent}`);
    return det;
  }

  if (modelActs) {
    const modelTarget = data.target;
    const detTarget = det.target;

    // The kind is stated outright ("the note", "my goal") far more reliably
    // than a 1B model infers it — and getting it wrong deletes from the wrong
    // table entirely.
    data.target = {
      kind: (detActs && detTarget?.kind) || modelTarget?.kind || "task",
      query: modelTarget?.query || detTarget?.query || null,
      ref: modelTarget?.ref ?? detTarget?.ref ?? null,
    };

    // An UPDATE with nothing to change is a no-op that reads like a failure.
    if (data.intent === "UPDATE") {
      const modelPatch = data.patch ?? {};
      const detPatch = det.intent === "UPDATE" ? (det.patch ?? {}) : {};
      if (!Object.keys(modelPatch).length && Object.keys(detPatch).length) {
        data.patch = detPatch;
      } else if (Object.keys(detPatch).length) {
        // The model wins on everything except the date. Same reason as the
        // create path: asked to move something to "Friday morning" a small
        // model returns tomorrow at 09:00 — a value that parses cleanly, so
        // nothing downstream can tell it's the wrong day. chrono actually
        // resolves weekday names.
        data.patch = {
          ...detPatch,
          ...modelPatch,
          ...(detPatch.dueAt ? { dueAt: detPatch.dueAt } : {}),
        };
      }
    }
  }

  // A create intent with an empty payload used to reply "Note saved." while
  // writing nothing at all. Fill it from the utterance instead of lying.
  if (data.intent === "CREATE_NOTE" && !data.note && det.note) {
    data.note = det.note;
  }
  if (
    (data.intent === "CREATE_TASK" || data.intent === "CREATE_TASKS")
    && !data.tasks?.length
    && det.tasks?.length
  ) {
    data.tasks = det.tasks;
  }
  if (data.intent === "CREATE_GOAL" && !data.goal && det.goal) {
    data.goal = det.goal;
  }

  if (data.tasks) {
    // The model is better at intent and titles; the keyword rules are better at
    // never dropping an explicit date or interval. Take the best of each rather
    // than trusting one wholesale.
    const fallbackRRule = recurrenceOf(input);

    // An explicit clock time in the utterance ("3PM tomorrow") is the one thing
    // chrono is strictly better at than a 1B model. The observed failure is the
    // model echoing the injected "now" with the day incremented and the stated
    // time dropped — a value that parses fine, so the missing-date repair below
    // never fires. When the text names an hour outright, chrono's reading wins.
    //
    // Single-task only: with several tasks there is one utterance-wide time and
    // no way to tell which task it belongs to, so stamping it on all of them
    // would trade one wrong dueAt for many.
    const statedTime =
      data.tasks.length === 1
        ? parseDateInTz(
            (text, r) => {
              const [m] = chrono.parse(text, r, { forwardDate: true });
              return m && m.start.isCertain("hour") ? m.start.date() : null;
            },
            input, safeTz(ctx.timezone), now,
          )
        : null;

    data.tasks = data.tasks.map((t) => {
      if (statedTime) {
        t.dueAt = statedTime.toISOString();
      } else if (!t.dueAt || isNaN(new Date(t.dueAt).getTime())) {
        // Same timezone round-trip as the fallback parser — the model's dates
        // are already absolute, but our repair must not be server-relative.
        const guess = parseDateInTz(
          (text, r) => chrono.parseDate(text, r, { forwardDate: true }),
          input, safeTz(ctx.timezone), now,
        );
        if (guess) t.dueAt = guess.toISOString();
      }

      // `t.rrule` is null either because the model omitted the recurrence or
      // because it emitted one that failed normalization (see lib/ai/schema.ts).
      // Both are recoverable when the text says "every 3 days" outright.
      if (!t.rrule && fallbackRRule) t.rrule = fallbackRRule;

      return t;
    });
  }

  return data;
}
