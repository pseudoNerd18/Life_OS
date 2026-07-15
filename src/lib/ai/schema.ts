/**
 * Lenient schemas for *model* output.
 *
 * A local model will confidently emit `"LANGUAGE"` for a category, `"Medium"`
 * for a priority, or `"2026-09-27"` for a timestamp. Validating that with the
 * same strict enums used for the HTTP API meant a single out-of-vocabulary
 * value threw away an otherwise perfect plan or extraction — and the app fell
 * back to the keyword parser with no sign of why.
 *
 * So: strict at the API boundary (a client sending junk deserves a 400),
 * forgiving at the model boundary (coerce what we can, default the rest).
 *
 * These are deliberately NOT used by `lib/validation.ts`'s `taskInputZ` and
 * friends. That distinction is the point.
 */
import { z } from "zod";
import { rrulestr } from "rrule";

const CATEGORIES = [
  "WORK", "PERSONAL", "HEALTH", "LEARNING",
  "FINANCE", "SOCIAL", "HOME", "OTHER",
] as const;

/** Common inventions, mapped to the closest real category. */
const CATEGORY_SYNONYMS: Record<string, (typeof CATEGORIES)[number]> = {
  LANGUAGE: "LEARNING",
  EDUCATION: "LEARNING",
  STUDY: "LEARNING",
  SKILL: "LEARNING",
  CAREER: "WORK",
  BUSINESS: "WORK",
  PROFESSIONAL: "WORK",
  PROJECT: "WORK",
  FITNESS: "HEALTH",
  EXERCISE: "HEALTH",
  WELLNESS: "HEALTH",
  MEDICAL: "HEALTH",
  NUTRITION: "HEALTH",
  MINDFULNESS: "HEALTH",
  "SELF-REFLECTION": "PERSONAL",
  "SELF-CARE": "PERSONAL",
  REFLECTION: "PERSONAL",
  HABIT: "PERSONAL",
  MONEY: "FINANCE",
  BUDGET: "FINANCE",
  FAMILY: "SOCIAL",
  FRIENDS: "SOCIAL",
  RELATIONSHIP: "SOCIAL",
  CHORES: "HOME",
  HOUSEHOLD: "HOME",
  ERRAND: "HOME",
  ERRANDS: "HOME",
};

/** Category, coerced. Anything unrecognizable becomes OTHER. */
export const modelCategoryZ = z
  .unknown()
  .transform((v) => {
    if (typeof v !== "string") return "OTHER" as const;
    const key = v.trim().toUpperCase().replace(/\s+/g, "_");
    if ((CATEGORIES as readonly string[]).includes(key)) {
      return key as (typeof CATEGORIES)[number];
    }
    return CATEGORY_SYNONYMS[key]
      ?? CATEGORY_SYNONYMS[key.replace(/_/g, "-")]
      ?? ("OTHER" as const);
  })
  .default("OTHER");

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

/** Priority, coerced. Unknown values become MEDIUM. */
export const modelPriorityZ = z
  .unknown()
  .transform((v) => {
    if (typeof v !== "string") return "MEDIUM" as const;
    const key = v.trim().toUpperCase();
    if ((PRIORITIES as readonly string[]).includes(key)) {
      return key as (typeof PRIORITIES)[number];
    }
    if (/CRITICAL|ASAP|IMMEDIATE/.test(key)) return "URGENT" as const;
    if (/^(VERY.?HIGH|TOP)$/.test(key)) return "HIGH" as const;
    if (/^(NORMAL|MODERATE|MID)$/.test(key)) return "MEDIUM" as const;
    if (/^(MINOR|OPTIONAL|NICE.?TO.?HAVE)$/.test(key)) return "LOW" as const;
    return "MEDIUM" as const;
  })
  .default("MEDIUM");

/**
 * A timestamp from a model. Accepts a full ISO instant or a bare `YYYY-MM-DD`
 * (which models emit far more often); anything unparseable becomes null rather
 * than failing the enclosing object.
 */
export const modelDateZ = z
  .unknown()
  .transform((v) => {
    if (typeof v !== "string" || !v.trim()) return null;
    const t = v.trim();
    const d = /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(`${t}T00:00:00.000Z`) : new Date(t);
    return isNaN(d.getTime()) ? null : d.toISOString();
  })
  .nullable()
  .default(null);

/** A positive integer duration, or null. Tolerates "60" and 60.5. */
export const modelDurationZ = z
  .unknown()
  .transform((v) => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n);
  })
  .nullable()
  .default(null);

const FREQS = ["SECONDLY", "MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;

/**
 * An RFC 5545 RRULE from a model, normalized — or null.
 *
 * Observed in the wild from gemma3:1b: `"RRULE: FREQ=3,INTERVAL=3"`. Three
 * separate problems in eleven characters — a stray `RRULE:` prefix, `FREQ=3`
 * which is not a frequency, and commas where semicolons belong. It was stored
 * verbatim, so anything that later fed `Task.rrule` to the `rrule` library
 * would throw on read.
 *
 * Normalize what is recoverable, drop what is not. A null recurrence is a
 * lesser failure than a corrupt one.
 */
export function normalizeRRule(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;

  // Strip a leading "RRULE:" (and any "DTSTART:...;" the model prepended).
  s = s.replace(/^RRULE\s*:\s*/i, "").trim();
  if (!s) return null;

  // Split into KEY=VALUE pairs. Commas are legal *inside* a value (BYDAY=TU,TH)
  // but models also use them as pair separators, so only split on a comma that
  // is directly followed by another KEY=.
  const pairs = s
    .split(/;|,(?=[A-Za-z]+=)/)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: string[] = [];
  let freq: string | null = null;

  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq < 1) return null;
    const key = pair.slice(0, eq).trim().toUpperCase();
    const value = pair.slice(eq + 1).trim().toUpperCase();
    if (!value) continue;

    if (key === "FREQ") {
      // "FREQ=3" and friends are unrecoverable — there is no way to know which
      // frequency was meant, and guessing would silently invent a schedule.
      if (!(FREQS as readonly string[]).includes(value)) return null;
      freq = value;
      out.unshift(`FREQ=${value}`);
      continue;
    }
    if (key === "INTERVAL") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) continue;
      out.push(`INTERVAL=${n}`);
      continue;
    }
    out.push(`${key}=${value}`);
  }

  if (!freq) return null;

  const candidate = out.join(";");
  try {
    // Final authority: if the library we read this back with can't parse it,
    // it does not go in the database.
    rrulestr(`RRULE:${candidate}`);
  } catch {
    return null;
  }
  return candidate;
}

/** RRULE from model output, normalized to a valid rule or null. */
export const modelRRuleZ = z.unknown().transform(normalizeRRule).nullable().default(null);
