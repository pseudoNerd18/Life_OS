/**
 * Pure decision logic for two-way calendar sync.
 *
 * Kept separate from `sync.ts` — which does I/O against Google and the DB — so
 * the rules that actually decide whether data is overwritten can be unit
 * tested without a network or a database.
 */

/** Which side of a two-way sync should win. */
export type Direction = "push" | "pull" | "noop";

export interface Decision {
  direction: Direction;
  /** True when both sides moved since they last agreed. */
  conflict: boolean;
}

/**
 * Decide what to do with one linked task/event pair.
 *
 * `agreedAt` is the moment the two sides last matched (`Task.syncedAt`). Any
 * side whose timestamp is newer than that has unpushed changes.
 *
 * Ties go to the remote side: a human editing in Google Calendar is a more
 * deliberate signal than our own local mutations, which can be produced by
 * autosave or an AI extraction pass.
 */
export function decide(input: {
  localUpdatedAt: Date;
  remoteUpdatedAt: Date | null;
  agreedAt: Date | null;
}): Decision {
  const { localUpdatedAt, remoteUpdatedAt, agreedAt } = input;

  // Never synced: the local task is the only thing that exists remotely-unknown.
  if (!agreedAt) return { direction: "push", conflict: false };

  const localChanged = localUpdatedAt > agreedAt;
  const remoteChanged = !!remoteUpdatedAt && remoteUpdatedAt > agreedAt;

  if (!localChanged && !remoteChanged) return { direction: "noop", conflict: false };
  if (localChanged && !remoteChanged) return { direction: "push", conflict: false };
  if (!localChanged && remoteChanged) return { direction: "pull", conflict: false };

  // Both moved. Remote wins ties, hence >= rather than >.
  return {
    direction: remoteUpdatedAt! >= localUpdatedAt ? "pull" : "push",
    conflict: true,
  };
}

/** A concrete span on the calendar. */
export interface Span {
  start: Date;
  end: Date;
  allDay: boolean;
}

export const DEFAULT_DURATION_MIN = 30;

/**
 * The span a task occupies. `startAt` wins over `dueAt` when both are set —
 * a due time is a deadline, a start time is when the work actually happens.
 * Returns null for an unscheduled task, which has no place on a calendar.
 */
export function taskSpan(task: {
  startAt: Date | null;
  dueAt: Date | null;
  durationMin: number | null;
}): Span | null {
  const start = task.startAt ?? task.dueAt;
  if (!start || Number.isNaN(start.getTime())) return null;
  const mins = task.durationMin && task.durationMin > 0 ? task.durationMin : DEFAULT_DURATION_MIN;
  return { start, end: new Date(start.getTime() + mins * 60_000), allDay: false };
}

/**
 * The span a Google event occupies.
 *
 * Google uses `dateTime` for timed events and `date` for all-day ones. Real
 * calendars also contain events with a missing, malformed, or inverted end —
 * imported ICS feeds are a common source — so the end is repaired rather than
 * allowed to produce a negative-length event on the grid.
 */
export function eventSpan(event: {
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}): Span | null {
  const rawStart = event.start?.dateTime ?? event.start?.date;
  if (!rawStart) return null;
  const start = new Date(rawStart);
  if (Number.isNaN(start.getTime())) return null;

  const allDay = !event.start?.dateTime;
  const fallbackMs = allDay ? 86_400_000 : 60 * 60_000;

  const rawEnd = event.end?.dateTime ?? event.end?.date;
  let end = rawEnd ? new Date(rawEnd) : new Date(start.getTime() + fallbackMs);
  if (Number.isNaN(end.getTime()) || end <= start) {
    end = new Date(start.getTime() + fallbackMs);
  }
  return { start, end, allDay };
}

/** Minutes a span covers, floored at 1 so a zero-length event stays visible. */
export function spanMinutes(span: Span): number {
  return Math.max(1, Math.round((span.end.getTime() - span.start.getTime()) / 60_000));
}
