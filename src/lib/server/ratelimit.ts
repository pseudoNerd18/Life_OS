/**
 * Lightweight in-memory rate limiter.
 *
 * Single-process only — fine for a local-first app. If the project later
 * moves to a multi-instance deploy, swap this for Upstash or a token bucket
 * backed by Postgres.
 *
 * Two properties worth keeping:
 *
 *  - **The map is swept.** Keys are per-user, and guest users are minted per
 *    cookie, so an unswept map is an unbounded leak keyed by every visitor the
 *    process has ever seen.
 *  - **Cost-tiered budgets.** A chat turn and a full goal plan are not the same
 *    amount of work. `rateLimit` keeps the original 30/min default; the tiers
 *    below apply tighter budgets to the endpoints that do real inference.
 */
const memory = new Map<string, { count: number; resetAt: number }>();

/** Sweep expired slots. O(n) but only runs once the map is worth sweeping. */
function sweep(now: number) {
  if (memory.size < 512) return;
  for (const [k, v] of memory) if (v.resetAt < now) memory.delete(k);
}

function memoryLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  sweep(now);
  const slot = memory.get(key);
  if (!slot || slot.resetAt < now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  slot.count++;
  return {
    success: slot.count <= limit,
    remaining: Math.max(0, limit - slot.count),
    resetAt: slot.resetAt,
  };
}

/** Default budget: conversational endpoints. 30 requests/minute. */
export async function rateLimit(key: string) {
  return memoryLimit(key, 30, 60_000);
}

/**
 * Budgets for the endpoints that actually cost something. Goal planning is a
 * long synchronous generation that rewrites a whole plan; transcription accepts
 * up to 25MB and runs Whisper.
 */
export const BUDGETS = {
  chat: { limit: 30, windowMs: 60_000 },
  extract: { limit: 30, windowMs: 60_000 },
  briefing: { limit: 10, windowMs: 60_000 },
  plan: { limit: 5, windowMs: 60_000 },
  transcribe: { limit: 12, windowMs: 60_000 },
  // Hands-free dictation fires one of these every ~1s while you speak. The real
  // throttle is that the client keeps a single request in flight; this is just a
  // runaway guard.
  transcribePartial: { limit: 240, windowMs: 60_000 },
  // A full two-way calendar sync is many Google API calls; the button is also
  // easy to lean on while waiting.
  calendarSync: { limit: 10, windowMs: 60_000 },
  // Note images land as rows in Postgres at up to 10MB each. Dropping a folder
  // of screenshots into a note is a legitimate burst, so the budget is roomy —
  // it exists to bound a runaway client, not to pace a real editing session.
  noteImage: { limit: 60, windowMs: 60_000 },
} as const;

export async function rateLimitFor(kind: keyof typeof BUDGETS, userId: string) {
  const { limit, windowMs } = BUDGETS[kind];
  return memoryLimit(`${kind}:${userId}`, limit, windowMs);
}

/** Test hook. */
export function _resetRateLimits() {
  memory.clear();
}
