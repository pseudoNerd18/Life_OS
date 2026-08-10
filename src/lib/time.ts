/**
 * Timezone-correct day boundaries.
 *
 * Every user carries a `timezone`, but "today" used to be computed from the
 * server's local clock (`new Date().setHours(0,0,0,0)`). Two things broke:
 *
 *   1. "Due today" was the *server's* today, not the user's.
 *   2. `DailyBriefing.forDate` is a `@db.Date` column. Storing a local
 *      midnight means Postgres truncates the UTC instant, so an IST server
 *      wrote yesterday's date — the dedupe key drifted and the UI showed the
 *      wrong day.
 *
 * Both are fixed by deriving the calendar date in the user's zone, then
 * anchoring instants explicitly.
 */

/** The calendar date in `tz`, as `{ y, m, d }` (m is 1-based). */
export function civilDateIn(tz: string, at: Date = new Date()) {
  // `en-CA` renders as YYYY-MM-DD, which parses without ambiguity.
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

/** Offset of `tz` from UTC, in minutes, at the instant `at`. */
function tzOffsetMinutes(tz: string, at: Date): number {
  // Reading the wall clock in `tz` as if it were UTC gives the offset directly.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour"), get("minute"), get("second"),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * Start and end (exclusive) of the user's current day, as real UTC instants —
 * the form Prisma wants for `DateTime` comparisons.
 */
export function dayRangeIn(tz: string, at: Date = new Date()): { start: Date; end: Date } {
  const { y, m, d } = civilDateIn(tz, at);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  // Two passes so a DST transition landing on midnight still resolves.
  let start = new Date(naive - tzOffsetMinutes(tz, at) * 60_000);
  start = new Date(naive - tzOffsetMinutes(tz, start) * 60_000);
  const end = new Date(start.getTime() + 86_400_000);
  return { start, end };
}

/**
 * The user's current calendar date as UTC midnight — the correct value for a
 * Postgres `date` column, which stores no zone.
 */
export function dateKeyIn(tz: string, at: Date = new Date()): Date {
  const { y, m, d } = civilDateIn(tz, at);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

/** UTC instant of local midnight for the civil date `(y, m, d)` in `tz`. */
function instantForCivilDate(tz: string, y: number, m: number, d: number): Date {
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  // Two passes so a DST transition landing on midnight still resolves.
  let at = new Date(naive - tzOffsetMinutes(tz, new Date(naive)) * 60_000);
  at = new Date(naive - tzOffsetMinutes(tz, at) * 60_000);
  return at;
}

/**
 * The full-week-padded grid for calendar month `month` (1-based) of `year`,
 * in the user's zone: the Sunday on/before the 1st through the Saturday
 * on/after the month's last day.
 *
 * `start`/`end` are real UTC instants for the Prisma query (`end` exclusive);
 * `startDate` is the same first day as a `YYYY-MM-DD` civil date, which is
 * what the grid renders from so server and browser lay out identically.
 *
 * The weekday math runs on plain UTC calendar dates — it's timezone-agnostic
 * by construction, since a given civil date is the same weekday everywhere.
 */
export function monthGridRange(tz: string, year: number, month: number): {
  start: Date; end: Date; startDate: string; weeks: number;
} {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const first = new Date(Date.UTC(year, month - 1, 1 - firstWeekday));

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastWeekday = new Date(Date.UTC(year, month - 1, daysInMonth)).getUTCDay();
  const afterLast = new Date(Date.UTC(year, month - 1, daysInMonth + (6 - lastWeekday) + 1));

  const days = Math.round((afterLast.getTime() - first.getTime()) / 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const parts = (d: Date) => [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()] as const;

  return {
    start: instantForCivilDate(tz, ...parts(first)),
    end: instantForCivilDate(tz, ...parts(afterLast)),
    startDate: iso(first),
    weeks: days / 7,
  };
}

/** Hour of day (0–23) in `tz` — for greetings and time-of-day copy. */
export function hourIn(tz: string, at: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" })
      .format(at),
  );
}

/** Day of week in `tz`, 0 = Sunday — matches `Date.prototype.getDay()`. */
export function weekdayIn(tz: string, at: Date = new Date()): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(at);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** Safe wrapper: an unknown/invalid tz string falls back to UTC. */
export function safeTz(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/**
 * Parse a natural-language date *as the user's wall clock*.
 *
 * chrono-node resolves "tomorrow evening" against the **server's** local time.
 * On a server in a different zone from the user, every relative date lands
 * hours off — and for a user near midnight, on the wrong day.
 *
 * The fix is a round trip: shift the reference instant so the server's local
 * wall clock matches the user's, let chrono parse, then shift the answer back
 * into a real UTC instant.
 *
 * `chrono` is passed in by the caller so this module stays dependency-free.
 */
export function parseDateInTz(
  parse: (text: string, ref: Date) => Date | null,
  text: string,
  tz: string,
  now: Date = new Date(),
): Date | null {
  const shiftMin = tzOffsetMinutes(tz, now) - -now.getTimezoneOffset();
  if (shiftMin === 0) return parse(text, now);

  const shiftedRef = new Date(now.getTime() + shiftMin * 60_000);
  const parsed = parse(text, shiftedRef);
  if (!parsed) return null;
  return new Date(parsed.getTime() - shiftMin * 60_000);
}
