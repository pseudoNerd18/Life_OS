/**
 * Two-way Google Calendar sync.
 *
 * ── Direction of truth ───────────────────────────────────────
 * Google events we did NOT create become `CalendarEvent` rows (read-only
 * mirrors, shown on the grid). Life OS tasks with a scheduled time are pushed
 * to Google as real events.
 *
 * ── Echo suppression ─────────────────────────────────────────
 * Every event we push carries `extendedProperties.private.lifeosTaskId`. On the
 * way back in, an event with that marker is recognised as our own and is NOT
 * mirrored into a `CalendarEvent` row — otherwise every synced task would show
 * up twice on the calendar, once as a task and once as an event.
 *
 * ── Conflict resolution ──────────────────────────────────────
 * `Task.syncedAt` records the moment the two sides last agreed. From there:
 *   · only `task.updatedAt` moved  → we changed it   → push
 *   · only `event.updated` moved   → they changed it → pull into the task
 *   · both moved                   → last write wins, and it's reported
 * Ties go to the remote side: a human editing in Google Calendar is a more
 * deliberate signal than our own autosave-ish local mutations.
 */
import { prisma } from "@/lib/db";
import {
  type GoogleEvent,
  SyncTokenExpired,
  TASKS_SCOPE,
  deleteEvent,
  insertEvent,
  listEvents,
  patchEvent,
} from "@/lib/calendar/google";
import { type GoogleTask, deleteTask, listTaskLists, listTasks, patchTask } from "@/lib/calendar/google-tasks";
import { type AccountRow, getValidAccessToken } from "@/lib/calendar/tokens";
import { decide, eventSpan, spanMinutes, taskSpan } from "@/lib/calendar/reconcile";

/**
 * The literal string Google puts in the description of a Task shown through
 * the Calendar API — a Google Task surfaces there as a read-only shadow
 * event, editable only via the Tasks API. Used to recognise (and skip
 * mirroring) these during the regular Calendar pull, since `pullTasks`
 * represents the same item properly via the Tasks API instead.
 */
const TASK_SHADOW_MARKER = /tasks\.google\.com\/task\//;

/** How far out a first (full) read reaches. Unbounded history is useless here. */
const WINDOW_BACK_DAYS = 30;
const WINDOW_FORWARD_DAYS = 180;
const MARKER = "lifeosTaskId";
const EVENT_MARKER = "lifeosEventId";

export interface SyncReport {
  accountId: string;
  email: string;
  /** Non-Life-OS events mirrored in. */
  pulled: number;
  /** Mirrored events removed because they were cancelled upstream. */
  removed: number;
  /** Tasks created as new Google events. */
  pushed: number;
  /** Existing Google events updated from their task. */
  updated: number;
  /** Local CalendarEvents created as new Google events. */
  eventsPushed: number;
  /** Existing Google events updated from a local CalendarEvent edit. */
  eventsUpdated: number;
  /** Remote edits applied back onto a task. */
  appliedRemote: number;
  /** Google events withdrawn because their task was cancelled. */
  reaped: number;
  /**
   * Tasks unlinked this run because their event was deleted in Google. They are
   * skipped by the push pass, so a deletion isn't undone in the same breath.
   *
   * Known limitation: a still-dated task is contractually "on the calendar", so
   * a LATER sync will create a fresh event for it. Making a Google-side delete
   * stick permanently needs a per-task opt-out flag, which the schema has no
   * column for yet.
   */
  unlinked: string[];
  /** Both sides had changed; the winner is named. */
  conflicts: { taskId: string; winner: "local" | "remote" }[];
  /** Same as `conflicts`, but for local CalendarEvent edits vs. remote edits. */
  eventConflicts: { eventId: string; winner: "local" | "remote" }[];
  fullResync: boolean;
  errors: string[];
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  accountId: string | null;
  externalId: string | null;
  syncedAt: Date | null;
  updatedAt: Date;
  googleTaskListId: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  startAt: Date | null;
  durationMin: number | null;
  externalId: string | null;
  calendarAccountId: string | null;
  syncedAt: Date | null;
  updatedAt: Date;
  status: string;
}

// ── Mapping ───────────────────────────────────────────────────

function taskToGoogleBody(task: TaskRow, timeZone: string): Record<string, unknown> | null {
  const win = taskSpan(task);
  if (!win) return null;
  return {
    summary: task.title,
    description: task.description ?? undefined,
    start: { dateTime: win.start.toISOString(), timeZone },
    end: { dateTime: win.end.toISOString(), timeZone },
    // The marker is how we recognise this event as ours on the way back in.
    extendedProperties: { private: { [MARKER]: task.id } },
  };
}

function markerTaskId(e: GoogleEvent): string | null {
  return e.extendedProperties?.private?.[MARKER] ?? null;
}

function eventToGoogleBody(event: EventRow, timeZone: string): Record<string, unknown> {
  return {
    summary: event.title,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    start: event.allDay
      ? { date: event.startAt.toISOString().slice(0, 10) }
      : { dateTime: event.startAt.toISOString(), timeZone },
    end: event.allDay
      ? { date: event.endAt.toISOString().slice(0, 10) }
      : { dateTime: event.endAt.toISOString(), timeZone },
    // Same recognition trick as tasks — lets a pull tell "this is one of ours,
    // already mirrored under this id" apart from a Google-native event.
    extendedProperties: { private: { [EVENT_MARKER]: event.id } },
  };
}

/**
 * Record that a task and its remote event now agree.
 *
 * This has to be raw SQL. Prisma applies `@updatedAt` on every `update()`, so
 * writing `syncedAt: new Date()` through the client bumps `updatedAt` past it in
 * the same breath — the task then looks locally-modified on the very next sync
 * and gets pushed again forever. Setting `syncedAt = updatedAt` in the database
 * sidesteps the client's timestamp handling and establishes the invariant the
 * comparison actually needs: after a sync, `updatedAt <= syncedAt`.
 */
async function markSynced(taskId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    'UPDATE "Task" SET "syncedAt" = "updatedAt" WHERE "id" = $1',
    taskId,
  );
}

/** Same trick as `markSynced`, for the CalendarEvent table. */
async function markEventSynced(eventId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    'UPDATE "CalendarEvent" SET "syncedAt" = "updatedAt" WHERE "id" = $1',
    eventId,
  );
}

/**
 * Is this row something the user owns here, rather than a plain mirror of a
 * remote event? Decides what a tombstone means: unlink, or delete.
 *
 * Two ways it can be owned locally. It originated in Life OS (`mirrored` is
 * false) — deleting that because Google tidied the copy away would destroy the
 * user's own event. Or it is a mirror carrying an edit made here that hasn't
 * reached the provider yet (`updatedAt` past `syncedAt`, the same comparison
 * `push()` uses to decide a row needs writing).
 *
 * The `mirrored` column exists for this: `syncedAt` is set on every mirror the
 * instant it is first pulled in, so testing it for null — which this used to do
 * — answers "has this ever synced", not "does the user own it", and reports
 * every mirror as owned. A cancelled remote event was therefore unlinked rather
 * than deleted and stayed on the calendar forever.
 */
function carriesLocalIntent(row: {
  mirrored: boolean;
  syncedAt: Date | null;
  updatedAt: Date;
}): boolean {
  if (!row.mirrored) return true;
  return row.syncedAt !== null && row.updatedAt > row.syncedAt;
}

/**
 * Detach a row from its provider account. Whatever it was mirroring is gone (or
 * unreachable), so it stops being a mirror and becomes an ordinary local event —
 * which is what keeps a later tombstone from deleting it as if it were still
 * somebody else's row.
 */
const UNLINK_EVENT = {
  accountId: null,
  externalId: null,
  googleTaskListId: null,
  syncedAt: null,
  mirrored: false,
} as const;

// ── Pull ──────────────────────────────────────────────────────

async function pull(
  account: AccountRow,
  token: string,
  report: SyncReport,
  timeZone: string,
): Promise<void> {
  const calendarId = account.calendarId || "primary";
  let result;
  try {
    result = await listEvents(token, { calendarId, syncToken: account.syncToken });
  } catch (err) {
    if (!(err instanceof SyncTokenExpired)) throw err;
    // Documented, expected: the cursor aged out. Start over on a bounded window.
    report.fullResync = true;
    result = await listEvents(token, {
      calendarId,
      syncToken: null,
      timeMin: new Date(Date.now() - WINDOW_BACK_DAYS * 86_400_000),
      timeMax: new Date(Date.now() + WINDOW_FORWARD_DAYS * 86_400_000),
    });
  }

  for (const e of result.events) {
    try {
      const ourTaskId = markerTaskId(e);

      if (e.status === "cancelled") {
        // Deleted upstream. If it was one of ours, unlink the task rather than
        // deleting it — losing a task because an event was tidied out of Google
        // would be a destructive surprise.
        //
        // A tombstone from an incremental page is usually just {id, status,
        // updated} with no extendedProperties, so the marker alone can't
        // identify it. Fall back to the link we recorded when we pushed it.
        const linked: { id: string } | null = ourTaskId
          ? { id: ourTaskId }
          : await prisma.task.findFirst({
              where: { userId: account.userId, calendarAccountId: account.id, externalId: e.id },
              select: { id: true },
            });
        if (linked) {
          await prisma.task.updateMany({
            where: { id: linked.id, userId: account.userId },
            data: { externalId: null, calendarAccountId: null, syncedAt: null },
          });
          report.unlinked.push(linked.id);
        } else {
          // Same fallback as tasks: an incremental tombstone rarely carries
          // extendedProperties, so identify it by the link we recorded.
          const existingEvent = await prisma.calendarEvent.findFirst({
            where: { accountId: account.id, externalId: e.id },
          });
          if (existingEvent && carriesLocalIntent(existingEvent)) {
            // Created here, or edited here since the last agreement — unlink
            // instead of deleting, so a Google-side tidy-up doesn't destroy the
            // user's own event. Same reasoning as task unlinking.
            await prisma.calendarEvent.updateMany({
              where: { id: existingEvent.id },
              data: { ...UNLINK_EVENT },
            });
            report.unlinked.push(existingEvent.id);
          } else {
            // A plain mirror of an event that no longer exists. Delete it —
            // leaving it behind is a ghost the user cannot explain.
            const del = await prisma.calendarEvent.deleteMany({
              where: { accountId: account.id, externalId: e.id },
            });
            report.removed += del?.count ?? 0;
          }
        }
        continue;
      }

      if (ourTaskId) {
        await applyRemoteEditToTask(account, e, ourTaskId, report);
        continue;
      }

      if (TASK_SHADOW_MARKER.test(e.description ?? "")) {
        // A Google Task shown read-only through the Calendar API. `pullTasks`
        // represents it properly via the Tasks API — mirroring it here too
        // would show it twice. Clean up a stale plain-mirror row from before
        // this distinction existed, so the fix is self-healing.
        await prisma.calendarEvent.deleteMany({
          where: { accountId: account.id, externalId: e.id, googleTaskListId: null },
        });
        continue;
      }

      const when = eventSpan(e);
      if (!when) continue;

      const data = {
        userId: account.userId,
        accountId: account.id,
        externalId: e.id,
        title: e.summary?.trim() || "(untitled)",
        description: e.description ?? null,
        location: e.location ?? null,
        startAt: when.start,
        endAt: when.end,
        allDay: when.allDay,
        attendees: (e.attendees ?? []).map((a) => a.email).filter((x): x is string => !!x),
        rrule: e.recurrence?.[0] ?? null,
      };

      const existing = await prisma.calendarEvent.findFirst({
        where: { accountId: account.id, externalId: e.id },
      });

      if (!existing) {
        // First time we've seen it — mirror it in, and mark it agreed-upon
        // immediately so a later local edit is what flags it for push, not
        // this initial pull. `mirrored` records that this row came from the
        // provider, which `syncedAt` alone cannot express; only the create path
        // sets it, since the update path below also runs for our own pushed
        // events coming back around.
        const created = await prisma.calendarEvent.create({ data: { ...data, mirrored: true } });
        await markEventSynced(created.id);
        report.pulled++;
        continue;
      }

      const remoteAt = e.updated ? new Date(e.updated) : null;
      const { direction, conflict } = decide({
        localUpdatedAt: existing.updatedAt,
        remoteUpdatedAt: remoteAt,
        agreedAt: existing.syncedAt,
      });
      if (conflict) {
        report.eventConflicts.push({
          eventId: existing.id,
          winner: direction === "pull" ? "remote" : "local",
        });
      }
      // "push" and "noop" are handled by push() — a local edit not yet synced
      // must not be clobbered by the remote copy here.
      if (direction !== "pull") continue;

      await prisma.calendarEvent.update({ where: { id: existing.id }, data });
      await markEventSynced(existing.id);
      report.pulled++;
    } catch (err) {
      report.errors.push(`pull ${e.id}: ${(err as Error).message}`);
    }
  }

  void timeZone;
  if (result.nextSyncToken) {
    await prisma.calendarAccount.update({
      where: { id: account.id },
      data: { syncToken: result.nextSyncToken },
    });
  }
}

/**
 * An event we pushed came back changed. Decide whether the remote edit wins and,
 * if so, fold it into the task.
 */
async function applyRemoteEditToTask(
  account: AccountRow,
  e: GoogleEvent,
  taskId: string,
  report: SyncReport,
): Promise<void> {
  const task: TaskRow | null = await prisma.task.findFirst({
    where: { id: taskId, userId: account.userId },
  });
  if (!task) return;

  const remoteAt = e.updated ? new Date(e.updated) : null;
  if (!remoteAt || !task.syncedAt) return;

  const { direction, conflict } = decide({
    localUpdatedAt: task.updatedAt,
    remoteUpdatedAt: remoteAt,
    agreedAt: task.syncedAt,
  });
  if (conflict) {
    report.conflicts.push({ taskId, winner: direction === "pull" ? "remote" : "local" });
  }
  // "push" and "noop" are both handled by push() — nothing to fold in here.
  if (direction !== "pull") return;

  const when = eventSpan(e);
  const patch: Record<string, unknown> = {};
  if (e.summary?.trim()) patch.title = e.summary.trim();
  if (when) {
    patch.startAt = when.start;
    patch.dueAt = when.start;
    patch.durationMin = spanMinutes(when);
  }
  await prisma.task.update({ where: { id: task.id }, data: patch });
  await markSynced(task.id);
  report.appliedRemote++;
}

// ── Pull: Google Tasks ────────────────────────────────────────

/**
 * Mirror the account's Google Tasks in as `CalendarEvent` rows.
 *
 * Google Tasks live behind a different API from Calendar events, so they get
 * their own pass. A mirrored row carries `googleTaskListId`, which is what
 * `push()` and `withdrawCalendarEvent` branch on to write back to the right
 * service.
 *
 * Tasks carry a date-only `due` (Google discards the time component), so every
 * mirrored row is all-day by construction.
 */
async function pullTasks(
  account: AccountRow,
  token: string,
  report: SyncReport,
): Promise<void> {
  const lists = await listTaskLists(token);

  for (const list of lists) {
    let tasks: GoogleTask[];
    try {
      // Only what changed since the last run — Tasks has no sync-token cursor,
      // so `updatedMin` is the closest thing to an incremental read.
      tasks = await listTasks(token, list.id, { updatedMin: account.lastSyncedAt ?? undefined });
    } catch (err) {
      report.errors.push(`pull tasklist ${list.id}: ${(err as Error).message}`);
      continue;
    }

    for (const t of tasks) {
      try {
        const existing = await prisma.calendarEvent.findFirst({
          where: { accountId: account.id, externalId: t.id, googleTaskListId: list.id },
        });

        if (t.deleted) {
          if (!existing) continue;
          if (carriesLocalIntent(existing)) {
            // Carries local intent — unlink rather than destroy, same as the
            // calendar-event tombstone path.
            await prisma.calendarEvent.updateMany({
              where: { id: existing.id },
              data: { ...UNLINK_EVENT },
            });
            report.unlinked.push(existing.id);
          } else {
            await prisma.calendarEvent.deleteMany({ where: { id: existing.id } });
            report.removed++;
          }
          continue;
        }

        // An undated task has no place on a date grid — same reasoning that
        // keeps unscheduled local Tasks off the calendar.
        if (!t.due) continue;
        const due = new Date(t.due);
        if (Number.isNaN(due.getTime())) continue;

        const data = {
          userId: account.userId,
          accountId: account.id,
          externalId: t.id,
          googleTaskListId: list.id,
          title: t.title?.trim() || "(untitled)",
          description: t.notes ?? null,
          location: null,
          startAt: due,
          endAt: due,
          allDay: true,
          attendees: [],
          rrule: null,
        };

        if (!existing) {
          const created = await prisma.calendarEvent.create({ data: { ...data, mirrored: true } });
          await markEventSynced(created.id);
          report.pulled++;
          continue;
        }

        const { direction, conflict } = decide({
          localUpdatedAt: existing.updatedAt,
          remoteUpdatedAt: t.updated ? new Date(t.updated) : null,
          agreedAt: existing.syncedAt,
        });
        if (conflict) {
          report.eventConflicts.push({
            eventId: existing.id,
            winner: direction === "pull" ? "remote" : "local",
          });
        }
        if (direction !== "pull") continue;

        await prisma.calendarEvent.update({ where: { id: existing.id }, data });
        await markEventSynced(existing.id);
        report.pulled++;
      } catch (err) {
        report.errors.push(`pull task ${t.id}: ${(err as Error).message}`);
      }
    }
  }
}

// ── Push ──────────────────────────────────────────────────────

async function push(
  account: AccountRow,
  token: string,
  report: SyncReport,
  timeZone: string,
  hasTasksScope: boolean,
): Promise<void> {
  const calendarId = account.calendarId || "primary";

  // Only scheduled, live tasks belong on a calendar. An unscheduled task has
  // no instant to occupy, and a cancelled one shouldn't hold a slot.
  const tasks: TaskRow[] = await prisma.task.findMany({
    where: {
      userId: account.userId,
      status: { not: "CANCELLED" },
      OR: [{ dueAt: { not: null } }, { startAt: { not: null } }],
    },
    take: 500,
    orderBy: { updatedAt: "desc" },
  });

  for (const task of tasks) {
    try {
      // Its event was deleted in Google during this very run — re-creating it
      // now would visibly undo the user's deletion.
      if (report.unlinked.includes(task.id)) continue;

      const body = taskToGoogleBody(task, timeZone);
      if (!body) continue;

      if (!task.externalId) {
        const created = await insertEvent(token, calendarId, body);
        const id = created.id as string | undefined;
        if (!id) throw new Error("Google returned no event id");
        await prisma.task.update({
          where: { id: task.id },
          data: { externalId: id, calendarAccountId: account.id },
        });
        await markSynced(task.id);
        report.pushed++;
        continue;
      }

      // Already linked — only send it if our side actually moved since the
      // last agreement, so a sync with no local edits costs no writes.
      if (task.syncedAt && task.updatedAt <= task.syncedAt) continue;
      // A conflict already resolved in favour of the remote side must not be
      // undone here.
      if (report.conflicts.some((c) => c.taskId === task.id && c.winner === "remote")) continue;

      await patchEvent(token, calendarId, task.externalId, body);
      await markSynced(task.id);
      report.updated++;
    } catch (err) {
      const msg = (err as Error).message;
      // The event was deleted in Google — unlink so the next run recreates it.
      if (/→ 404|→ 410/.test(msg) && task.externalId) {
        await prisma.task
          .update({
            where: { id: task.id },
            data: { externalId: null, calendarAccountId: null, syncedAt: null },
          })
          .catch(() => {});
        continue;
      }
      report.errors.push(`push ${task.id}: ${msg}`);
    }
  }

  // Local CalendarEvents (created or edited here) linked to this account.
  // `syncedAt` gets set on every pull/push, so an untouched mirror never
  // shows up here as needing a write.
  const events: EventRow[] = await prisma.calendarEvent.findMany({
    where: { userId: account.userId, accountId: account.id },
    take: 500,
    orderBy: { updatedAt: "desc" },
  });

  for (const ev of events) {
    try {
      // Deleted in Google during this very run — recreating it now would
      // visibly undo the user's deletion.
      if (report.unlinked.includes(ev.id)) continue;

      if (ev.googleTaskListId) {
        // Backed by Google Tasks, not Calendar events. Only ever an update:
        // these rows exist because `pullTasks` mirrored them in, so there is
        // never a local-only one needing creation.
        if (!ev.externalId || !hasTasksScope) continue;
        if (ev.syncedAt && ev.updatedAt <= ev.syncedAt) continue;
        if (report.eventConflicts.some((c) => c.eventId === ev.id && c.winner === "remote")) continue;

        await patchTask(token, ev.googleTaskListId, ev.externalId, {
          title: ev.title,
          notes: ev.description ?? undefined,
          // Google keeps only the date part, but demands a full RFC 3339 value.
          due: ev.startAt.toISOString(),
        });
        await markEventSynced(ev.id);
        report.eventsUpdated++;
        continue;
      }

      const body = eventToGoogleBody(ev, timeZone);

      if (!ev.externalId) {
        const created = await insertEvent(token, calendarId, body);
        const id = created.id as string | undefined;
        if (!id) throw new Error("Google returned no event id");
        await prisma.calendarEvent.update({ where: { id: ev.id }, data: { externalId: id } });
        await markEventSynced(ev.id);
        report.eventsPushed++;
        continue;
      }

      if (ev.syncedAt && ev.updatedAt <= ev.syncedAt) continue;
      if (report.eventConflicts.some((c) => c.eventId === ev.id && c.winner === "remote")) continue;

      await patchEvent(token, calendarId, ev.externalId, body);
      await markEventSynced(ev.id);
      report.eventsUpdated++;
    } catch (err) {
      const msg = (err as Error).message;
      if (/→ 404|→ 410/.test(msg) && ev.externalId) {
        await prisma.calendarEvent
          .update({ where: { id: ev.id }, data: { ...UNLINK_EVENT } })
          .catch(() => {});
        continue;
      }
      report.errors.push(`push event ${ev.id}: ${msg}`);
    }
  }
}

/**
 * Withdraw Google events whose task is no longer live.
 *
 * `push()` deliberately skips cancelled tasks, which would otherwise leave
 * their event sitting on the calendar forever. A cancelled task shouldn't hold
 * a slot, so the event is deleted and the task unlinked.
 */
async function reap(account: AccountRow, token: string, report: SyncReport): Promise<void> {
  const calendarId = account.calendarId || "primary";
  const stale: TaskRow[] = await prisma.task.findMany({
    where: {
      userId: account.userId,
      calendarAccountId: account.id,
      externalId: { not: null },
      status: "CANCELLED",
    },
    take: 200,
  });

  for (const task of stale) {
    if (!task.externalId) continue;
    try {
      await deleteEvent(token, calendarId, task.externalId);
      await prisma.task.update({
        where: { id: task.id },
        data: { externalId: null, calendarAccountId: null, syncedAt: null },
      });
      report.reaped++;
    } catch (err) {
      report.errors.push(`reap ${task.id}: ${(err as Error).message}`);
    }
  }
}

// ── Entry points ──────────────────────────────────────────────

export async function syncAccount(
  account: AccountRow,
  opts: { timeZone?: string } = {},
): Promise<SyncReport> {
  const report: SyncReport = {
    accountId: account.id,
    email: account.email,
    pulled: 0,
    removed: 0,
    pushed: 0,
    updated: 0,
    eventsPushed: 0,
    eventsUpdated: 0,
    appliedRemote: 0,
    reaped: 0,
    unlinked: [],
    conflicts: [],
    eventConflicts: [],
    fullResync: false,
    errors: [],
  };

  const timeZone = opts.timeZone || "UTC";
  const token = await getValidAccessToken(account);

  // Pull first: learn what changed remotely before deciding what to push, so a
  // remote edit is never clobbered by a stale local write in the same run.
  await pull(account, token, report, timeZone);
  // Google Tasks needs a scope of its own. An account linked before that scope
  // existed simply has no Tasks access until the user reconnects — skip rather
  // than fail every sync on a guaranteed 403.
  const hasTasksScope = account.scope.split(/\s+/).includes(TASKS_SCOPE);
  if (hasTasksScope) {
    try {
      await pullTasks(account, token, report);
    } catch (err) {
      report.errors.push(`pull tasks: ${(err as Error).message}`);
    }
  }
  await push(account, token, report, timeZone, hasTasksScope);
  await reap(account, token, report);

  await prisma.calendarAccount.update({
    where: { id: account.id },
    data: { lastSyncedAt: new Date() },
  });
  return report;
}

/**
 * Remove a single task's Google event — used when a task is deleted outright,
 * where there is no later sync pass that could notice it went missing.
 *
 * Best-effort by design: the caller is mid-delete, and a Google outage must not
 * block removing the user's own local data. Returns whether the event was
 * withdrawn.
 */
export async function withdrawTaskEvent(task: {
  id: string;
  externalId: string | null;
  calendarAccountId: string | null;
}): Promise<boolean> {
  if (!task.externalId || !task.calendarAccountId) return false;
  try {
    const account: AccountRow | null = await prisma.calendarAccount.findUnique({
      where: { id: task.calendarAccountId },
    });
    if (!account || !account.isActive) return false;
    const token = await getValidAccessToken(account);
    await deleteEvent(token, account.calendarId || "primary", task.externalId);
    return true;
  } catch (err) {
    console.error(`[calendar] could not withdraw event for task ${task.id}:`, (err as Error).message);
    return false;
  }
}

/**
 * Remove a single CalendarEvent's Google event — used when the event is
 * deleted outright, mirroring `withdrawTaskEvent`. Best-effort: the local
 * delete must still happen if Google is unreachable.
 */
export async function withdrawCalendarEvent(event: {
  id: string;
  externalId: string | null;
  accountId: string | null;
  googleTaskListId?: string | null;
}): Promise<boolean> {
  if (!event.externalId || !event.accountId) return false;
  try {
    const account: AccountRow | null = await prisma.calendarAccount.findUnique({
      where: { id: event.accountId },
    });
    if (!account || !account.isActive) return false;
    const token = await getValidAccessToken(account);
    // A Task-backed row lives in the Tasks API — deleting it as a calendar
    // event would 404 and leave the real task in place.
    if (event.googleTaskListId) {
      await deleteTask(token, event.googleTaskListId, event.externalId);
      return true;
    }
    await deleteEvent(token, account.calendarId || "primary", event.externalId);
    return true;
  } catch (err) {
    console.error(`[calendar] could not withdraw event ${event.id}:`, (err as Error).message);
    return false;
  }
}

/** Syncs every active account for a user. One failure never blocks the others. */
export async function syncUser(
  userId: string,
  timeZone: string,
): Promise<{ reports: SyncReport[]; errors: string[] }> {
  const accounts: AccountRow[] = await prisma.calendarAccount.findMany({
    where: { userId, isActive: true },
  });
  const reports: SyncReport[] = [];
  const errors: string[] = [];
  for (const account of accounts) {
    try {
      reports.push(await syncAccount(account, { timeZone }));
    } catch (err) {
      errors.push(`${account.email}: ${(err as Error).message}`);
    }
  }
  return { reports, errors };
}
