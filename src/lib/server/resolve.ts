/**
 * Reference resolution: "the previous note", "the gym one", "that task".
 *
 * The model describes what the user meant; this turns that description into an
 * actual row. Keeping it server-side is deliberate — the model has no access to
 * ids, and a hallucinated one would quietly mutate or delete the wrong record.
 *
 * The scoring is intentionally boring and explainable. When you say "delete the
 * dentist one" you need to be able to predict what goes, and a fuzzy embedding
 * search is exactly the wrong tool for a destructive action.
 */
import { prisma } from "@/lib/db";

export type TargetKind = "task" | "note" | "goal";

export interface ResolvedTarget {
  kind: TargetKind;
  id: string;
  title: string;
  /** Higher is a better match. See scoreMatch. */
  score: number;
}

export type Resolution =
  | { status: "found"; target: ResolvedTarget }
  /** Several plausible matches — ask rather than pick. */
  | { status: "ambiguous"; candidates: ResolvedTarget[] }
  | { status: "none" };

/** How many recent rows we consider. Beyond this, "the previous one" is a lie. */
const WINDOW = 40;

const STOPWORDS = new Set([
  "the", "a", "an", "my", "that", "this", "it", "one", "ones", "please",
  "task", "note", "goal", "reminder", "item", "thing", "about", "for", "to",
  "of", "on", "in", "and", "or", "previous", "last", "recent",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Score a candidate against the user's words.
 *
 * 100 exact title, 80 title contains the whole phrase, else proportional token
 * overlap up to 60. Body text counts for less than the title — a note that
 * merely mentions "gym" shouldn't outrank one titled "Gym".
 */
export function scoreMatch(query: string, title: string, body?: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = title.trim().toLowerCase();
  if (!t) return 0;

  if (t === q) return 100;
  if (t.includes(q)) return 80;

  const qt = tokens(q);
  if (!qt.length) return 0;
  const tt = new Set(tokens(title));
  const bt = new Set(tokens(body ?? ""));

  let hits = 0;
  let bodyHits = 0;
  for (const token of qt) {
    if (tt.has(token)) hits++;
    else if (bt.has(token)) bodyHits++;
  }
  if (!hits && !bodyHits) return 0;
  // Title matches dominate; body matches are worth a third.
  return Math.round(((hits + bodyHits / 3) / qt.length) * 60);
}

/** Minimum score we'll act on without asking. */
const CONFIDENT = 40;
/** A runner-up this close to the winner means we genuinely can't tell. */
const TIE_MARGIN = 15;

interface Row { id: string; title: string; body?: string }

async function recentRows(userId: string, kind: TargetKind): Promise<Row[]> {
  if (kind === "note") {
    const notes = await prisma.note.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: WINDOW,
      select: { id: true, title: true, content: true },
    });
    return notes.map((n: { id: string; title: string; content: string }) => ({
      id: n.id, title: n.title, body: n.content,
    }));
  }
  if (kind === "goal") {
    const goals = await prisma.goal.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: WINDOW,
      select: { id: true, title: true, description: true },
    });
    return goals.map((g: { id: string; title: string; description: string | null }) => ({
      id: g.id, title: g.title, body: g.description ?? undefined,
    }));
  }
  const tasks = await prisma.task.findMany({
    // Cancelled tasks are already "gone" as far as the user is concerned;
    // resolving onto one would be baffling.
    where: { userId, status: { not: "CANCELLED" } },
    orderBy: { updatedAt: "desc" },
    take: WINDOW,
    select: { id: true, title: true, description: true },
  });
  return tasks.map((t: { id: string; title: string; description: string | null }) => ({
    id: t.id, title: t.title, body: t.description ?? undefined,
  }));
}

export async function resolveTarget(
  userId: string,
  target: { kind?: TargetKind | null; ref?: "last" | "previous" | null; query?: string | null },
  /**
   * Destructive callers get stricter rules: no falling back to "the most recent
   * one" when the description doesn't match anything. Mishearing "delete the
   * note about X" and removing an unrelated task is the worst outcome here, and
   * asking again costs the user one sentence.
   */
  opts: { destructive?: boolean } = {},
): Promise<Resolution> {
  const kind: TargetKind = target.kind ?? "task";
  const rows = await recentRows(userId, kind);
  if (!rows.length) return { status: "none" };

  const query = (target.query ?? "").trim();

  // No describing words — "the previous note", "delete that". Rows are already
  // ordered most-recent-first, so the head is what "previous" means.
  if (!query) {
    if (target.ref === "last" || target.ref === "previous" || rows.length === 1) {
      const r = rows[0];
      return { status: "found", target: { kind, id: r.id, title: r.title, score: 100 } };
    }
    return { status: "none" };
  }

  const scored = rows
    .map((r) => ({ kind, id: r.id, title: r.title, score: scoreMatch(query, r.title, r.body) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    // Described it, but nothing matched. If they also said "the last one",
    // fall back to recency — unless this would delete something, where a wrong
    // guess is unrecoverable in the moment.
    if (target.ref && !opts.destructive) {
      const r = rows[0];
      return { status: "found", target: { kind, id: r.id, title: r.title, score: 50 } };
    }
    return { status: "none" };
  }

  const [best, runnerUp] = scored;
  if (best.score < CONFIDENT) return { status: "none" };
  if (runnerUp && best.score - runnerUp.score < TIE_MARGIN) {
    return { status: "ambiguous", candidates: scored.slice(0, 3) };
  }
  return { status: "found", target: best };
}
