/**
 * Deterministic intent parser — the no-LLM fallback.
 *
 * When Ollama is unreachable, the assistant still needs to do something
 * useful. This parser uses chrono-node for dates and a small keyword ruleset
 * for category/priority/recurrence. It's intentionally simple and predictable.
 *
 * It will never be as good as Gemma at nuance, but it means the app is fully
 * functional with zero AI infrastructure — which is the whole local-first
 * promise.
 */
import * as chrono from "chrono-node";
import type { ExtractedIntent } from "@/lib/validation";
import { parseDateInTz, safeTz } from "@/lib/time";

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/\b(gym|workout|run|yoga|walk|vitamin|medicine|meditat|sleep|water|doctor|dentist)\b/i, "HEALTH"],
  [/\b(study|exam|gate|course|learn|read|practice|revis|assignment|lecture)\b/i, "LEARNING"],
  [/\b(meeting|email|report|deadline|client|presentation|standup|review|deploy|ship)\b/i, "WORK"],
  [/\b(bill|pay|budget|invoice|tax|rent|subscription|bank)\b/i, "FINANCE"],
  [/\b(call|text|birthday|friend|family|mom|dad|dinner|party|meet up)\b/i, "SOCIAL"],
  [/\b(clean|groceries|laundry|cook|dishes|repair|fix the|tidy)\b/i, "HOME"],
];

const HIGH_PRIORITY = /\b(urgent|asap|immediately|critical|important|deadline|today)\b/i;
const LOW_PRIORITY = /\b(sometime|eventually|whenever|someday|no rush|low priority)\b/i;

const RECURRENCE_RULES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/every\s+day|daily/i, () => "FREQ=DAILY"],
  [/every\s+(\d+)\s+days?/i, (m) => `FREQ=DAILY;INTERVAL=${m[1]}`],
  [/every\s+week|weekly/i, () => "FREQ=WEEKLY"],
  [/every\s+(\d+)\s+weeks?/i, (m) => `FREQ=WEEKLY;INTERVAL=${m[1]}`],
  [/every\s+month|monthly/i, () => "FREQ=MONTHLY"],
  [/every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i, (m) => {
    const days: Record<string, string> = {
      monday: "MO", tuesday: "TU", wednesday: "WE", thursday: "TH",
      friday: "FR", saturday: "SA", sunday: "SU",
    };
    return `FREQ=WEEKLY;BYDAY=${days[m[1].toLowerCase()]}`;
  }],
];

function categoryOf(text: string): string {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(text)) return cat;
  return "OTHER";
}

function priorityOf(text: string): string {
  if (HIGH_PRIORITY.test(text)) return "HIGH";
  if (LOW_PRIORITY.test(text)) return "LOW";
  return "MEDIUM";
}

/**
 * Exported so the LLM path can borrow it: a model will happily drop "every 3
 * days" from its output, or emit an RRULE that doesn't parse. The keyword rules
 * are dumber but never miss an explicit interval.
 */
export function recurrenceOf(text: string): string | null {
  for (const [re, build] of RECURRENCE_RULES) {
    const m = text.match(re);
    if (m) return build(m);
  }
  return null;
}

/** Strip leading command verbs so the task title reads cleanly. */
function cleanTitle(text: string): string {
  return text
    .replace(/^(remind me to|remember to|i need to|i have to|don'?t forget to|please|can you|add a task to|add|create a task to|create|schedule|set up a reminder to|make sure to)\s+/i, "")
    .replace(/\s+(every\s+\d*\s*\w+|tomorrow|today|tonight|next week|this week|at \d.*|on \w+day).*/i, "")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Split on " and " only when both sides really are separate instructions.
 *
 * A naive split turns "Buy bread and butter" into two tasks. A candidate part
 * counts as its own instruction if it opens with a verb or carries its own time
 * expression; otherwise it stays attached to the part before it.
 */
const ACTION_VERB = /^(buy|call|email|send|book|pay|finish|start|read|write|review|clean|cook|fix|check|schedule|prepare|study|practice|go|get|pick|drop|take|submit|renew|cancel|meet|visit|water|walk|run|remind|remember|update|reply|order|ship|deploy|test|plan)\b/i;
const TIME_HINT = /\b(today|tomorrow|tonight|next\s+\w+|this\s+\w+|on\s+\w+day|at\s+\d|in\s+\d+\s+(min|hour|day|week|month)|every\s+)/i;

function splitInstructions(text: string): string[] {
  const raw = text.split(/\s+and\s+/i);
  if (raw.length === 1) return raw;

  const parts: string[] = [raw[0]];
  for (const candidate of raw.slice(1)) {
    const c = candidate.trim();
    const standalone = ACTION_VERB.test(c) || TIME_HINT.test(c);
    if (standalone && c.length > 2) parts.push(c);
    else parts[parts.length - 1] += ` and ${c}`;
  }
  return parts.filter((p) => p.trim().length > 2);
}

/** Which kind of thing an utterance names, if it names one. */
function targetKindOf(text: string): "task" | "note" | "goal" {
  if (/\bnotes?\b/i.test(text)) return "note";
  if (/\bgoals?\b/i.test(text)) return "goal";
  return "task";
}

/** Strip the command verb and filler, leaving the words that identify the item. */
function targetQueryOf(text: string): string | null {
  const q = text
    .replace(/^(please\s+)?(can you\s+)?(go ahead and\s+)?/i, "")
    .replace(/^(delete|remove|cancel|scrap|drop|get rid of|erase|discard)\s+/i, "")
    .replace(/^(mark|tick|check)\s+(off\s+)?/i, "")
    .replace(/^(complete|finish|finished|completed|did)\s+/i, "")
    .replace(/^(update|change|edit|rename|modify|fix|correct)\s+/i, "")
    .replace(/\b(as\s+)?(done|complete|completed|finished)\b/gi, "")
    .replace(/^(the|that|this|my|it)\s+/i, "")
    .replace(/\b(previous|last|latest|recent)\b/gi, "")
    .replace(/\b(task|note|goal|reminder|item|one|thing)s?\b/gi, "")
    .replace(/^(about|for|on|regarding|called|titled|named)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return q.length > 1 ? q : null;
}

const REFERS_BACK = /\b(previous|last|latest|that|this|it)\b/i;

/**
 * Correction phrasing: "it should say X not Y", "change X to Y".
 * Returned as {from, to} so the caller edits in place rather than overwriting.
 */
function replacementOf(text: string): { from: string; to: string } | null {
  // "should say X not Y" / "should be X not Y"
  let m = text.match(/should (?:say|be|read)\s+(.+?)\s+(?:not|instead of|rather than)\s+(.+?)[.!?]*$/i);
  if (m) return { from: clean(m[2]), to: clean(m[1]) };
  // "say X not Y" without "should"
  m = text.match(/\bsays?\s+(.+?)\s+(?:not|instead of|rather than)\s+(.+?)[.!?]*$/i);
  if (m) return { from: clean(m[2]), to: clean(m[1]) };
  // "change X to Y" / "replace X with Y"
  m = text.match(/\b(?:change|replace|swap)\s+(.+?)\s+(?:to|with|for)\s+(.+?)[.!?]*$/i);
  if (m) return { from: clean(m[1]), to: clean(m[2]) };
  return null;
}

function clean(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "").replace(/[.!?]+$/, "").trim();
}

export function deterministicExtract(input: string, timezone?: string): ExtractedIntent {
  const text = input.trim();
  if (!text) return { intent: "UNKNOWN" };
  const tz = safeTz(timezone);

  // ── Act on something that already exists ───────────────────
  // Checked before the create heuristics: "delete the gym task" must not be
  // read as a request to create a task called "delete the gym task".

  if (/\b(delete|remove|cancel|scrap|get rid of|erase|discard)\b/i.test(text)) {
    return {
      intent: "DELETE",
      target: {
        kind: targetKindOf(text),
        ref: REFERS_BACK.test(text) ? "previous" : null,
        query: targetQueryOf(text),
      },
    };
  }

  if (/\b(mark|tick|check)\b.*\b(done|complete|completed|off)\b/i.test(text)
    || /\b(i (?:have )?(?:just )?(?:finished|completed|did))\b/i.test(text)
    || /^(finished|completed|done with)\b/i.test(text)) {
    return {
      intent: "COMPLETE",
      target: {
        kind: "task",
        ref: REFERS_BACK.test(text) ? "previous" : null,
        query: targetQueryOf(text),
      },
    };
  }

  const replace = replacementOf(text);
  const looksLikeEdit =
    replace !== null
    || /\b(rename|update|edit|correct|fix)\b/i.test(text)
    || /\b(move|reschedule|push)\b.*\b(to|until|till)\b/i.test(text)
    || /\b(make|set)\s+(it|that|the\s+\w+)\s+(high|low|urgent|medium)\b/i.test(text);

  if (looksLikeEdit) {
    const kind = targetKindOf(text);
    const patch: NonNullable<ExtractedIntent["patch"]> = {};
    if (replace) patch.replace = replace;

    const due = parseDateInTz(
      (t, r) => chrono.parseDate(t, r, { forwardDate: true }),
      text, tz, new Date(),
    );
    if (due && /\b(move|reschedule|push|due|to|until|till)\b/i.test(text)) {
      patch.dueAt = due.toISOString();
    }
    const pr = text.match(/\b(high|low|urgent|medium)\s+priority\b/i)
      ?? text.match(/\bmake\s+(?:it|that)\s+(high|low|urgent|medium)\b/i);
    if (pr) patch.priority = pr[1].toUpperCase() as never;

    if (Object.keys(patch).length) {
      return {
        intent: "UPDATE",
        target: {
          kind,
          ref: REFERS_BACK.test(text) ? "previous" : null,
          query: replace ? null : targetQueryOf(text),
        },
        patch,
      };
    }
  }

  // Goal heuristic
  if (/\b(prepare for|plan for|study plan|learn to|get better at|master|train for)\b/i.test(text)) {
    const months = text.match(/(\d+)\s+months?/i);
    let targetDate: string | null = null;
    if (months) {
      const d = new Date();
      d.setMonth(d.getMonth() + parseInt(months[1], 10));
      targetDate = d.toISOString();
    }
    return {
      intent: "CREATE_GOAL",
      goal: {
        title: cleanTitle(text),
        description: `Imported from: "${text}"`,
        category: categoryOf(text) as never,
        targetDate,
      },
    };
  }

  // Note heuristic
  if (/\b(note|notes|write down|jot down|document)\b/i.test(text)) {
    return {
      intent: "CREATE_NOTE",
      note: {
        title: cleanTitle(text).slice(0, 80) || "Untitled note",
        content: text,
        tags: [],
      },
    };
  }

  // Default: task. Possibly multiple — see splitInstructions.
  const parts = splitInstructions(text);
  const ref = new Date();

  const tasks = parts.map((part) => {
    // Relative dates resolve against the *user's* wall clock, not the server's.
    const due = parseDateInTz(
      (t, r) => chrono.parseDate(t, r, { forwardDate: true }),
      part, tz, ref,
    );
    return {
      title: cleanTitle(part) || part.trim(),
      category: categoryOf(part) as never,
      priority: priorityOf(part) as never,
      dueAt: due ? due.toISOString() : null,
      rrule: recurrenceOf(part),
      durationMin: /\b(gym|workout|meeting|study|practice)\b/i.test(part) ? 60 : null,
    };
  });

  return {
    intent: tasks.length > 1 ? "CREATE_TASKS" : "CREATE_TASK",
    tasks,
  };
}
