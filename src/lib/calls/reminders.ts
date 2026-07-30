/**
 * "Ring me two minutes before it starts."
 *
 * `runDueReminders` is a single sweep: find calendar events about to begin,
 * claim each one so it can only ring once, then dial. It is idempotent and
 * cheap enough to run every minute — see `src/instrumentation.ts`, which does.
 *
 * The ordering matters. Claiming *before* dialling means a Twilio outage costs
 * you one missed reminder; claiming after would mean a bug that throws
 * mid-request re-dials your phone on every tick until the meeting starts. For a
 * side effect that rings a real phone, the failure to prefer is obvious.
 */
import { prisma } from "@/lib/db";
import { placeCall, twilioConfig } from "@/lib/calls/twilio";
import { safeTz } from "@/lib/time";

/** How far ahead of the event the phone should ring. */
export const LEAD_MS = 2 * 60_000;

/**
 * Extra window on top of the lead time, so the sweep interval doesn't drag the
 * call late. With a 60s tick and no slack a "2 minute" reminder lands anywhere
 * from 120s to 61s out; half a tick of slack centres it on the promise instead.
 */
const SLACK_MS = 30_000;

export interface ReminderResult {
  /** Events whose reminder call Twilio accepted. */
  called: string[];
  /**
   * Subset of `called` that rang without naming the event, because the Twilio
   * account is on a trial and may not send custom TwiML.
   */
  generic: string[];
  /** Events claimed but which then failed to dial, with the reason. */
  failed: { eventId: string; error: string }[];
  /** Set when the sweep did nothing at all, for the caller to log once. */
  skipped?: "no-twilio";
}

/** What the phone says. Kept separate from the dialling so it can be tested. */
export function reminderMessage(
  title: string,
  startAt: Date,
  timezone: string,
): string {
  const time = startAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: safeTz(timezone),
  });
  return `Heads up. Your event, ${title}, starts in about two minutes, at ${time}.`;
}

/**
 * Place reminder calls for every event starting within the lead window.
 *
 * `now` is injectable so tests don't have to wait two minutes.
 */
export async function runDueReminders(now: Date = new Date()): Promise<ReminderResult> {
  const config = twilioConfig();
  if (!config) return { called: [], generic: [], failed: [], skipped: "no-twilio" };

  const horizon = new Date(now.getTime() + LEAD_MS + SLACK_MS);

  const due = await prisma.calendarEvent.findMany({
    where: {
      // Already started — the reminder has no value now, and after a process
      // restart there may be a backlog of these. Never dial about the past.
      startAt: { gt: now, lte: horizon },
      // An all-day event "starts" at local midnight. Nobody wants that call.
      allDay: false,
      user: { phone: { not: null }, callReminders: true },
    },
    select: {
      id: true,
      title: true,
      startAt: true,
      reminderCalledFor: true,
      user: { select: { phone: true, timezone: true } },
    },
    // A pathological calendar shouldn't turn one tick into a hundred calls.
    take: 25,
  });

  const called: string[] = [];
  const generic: string[] = [];
  const failed: { eventId: string; error: string }[] = [];

  for (const event of due) {
    const phone = event.user.phone;
    if (!phone) continue;
    // Comparing against the stored `startAt` rather than a boolean is what lets
    // a rescheduled event ring again: the claim is for a specific start time.
    if (event.reminderCalledFor?.getTime() === event.startAt.getTime()) continue;

    // Claim it. The `where` re-checks what we just read, so if a second sweep
    // (or a slow tick overlapping the next one) got here first, `count` is 0
    // and we leave the call to whoever won.
    const claim = await prisma.calendarEvent.updateMany({
      where: { id: event.id, reminderCalledFor: event.reminderCalledFor },
      data: { reminderCalledFor: event.startAt },
    });
    if (claim.count === 0) continue;

    try {
      const placed = await placeCall(
        phone,
        reminderMessage(event.title, event.startAt, event.user.timezone),
        config,
      );
      called.push(event.id);
      if (!placed.spokenMessage) generic.push(event.id);
    } catch (err) {
      // The claim stands. A reminder is worthless a minute late anyway, and a
      // retry loop against a real phone line is worse than a missed call.
      failed.push({ eventId: event.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { called, generic, failed };
}
