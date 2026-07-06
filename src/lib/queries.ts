/**
 * Query shapes shared between a server component and the API route its client
 * store polls. Keeping them in one place is what stops the two from drifting.
 */
import { dayRangeIn } from "@/lib/time";

/**
 * The dashboard's "today" set: open tasks due today or earlier (overdue
 * belongs on today's list — the briefing tells you to start there), undated
 * open tasks, and anything completed today so ticking a row doesn't make it
 * vanish mid-interaction.
 */
export function todayScopeWhere(userId: string, tz: string) {
  const { start, end } = dayRangeIn(tz);
  return {
    userId,
    OR: [
      { status: { in: ["TODO", "IN_PROGRESS", "SNOOZED"] as const }, dueAt: { lt: end } },
      { status: { in: ["TODO", "IN_PROGRESS", "SNOOZED"] as const }, dueAt: null },
      { status: "DONE" as const, completedAt: { gte: start, lt: end } },
    ],
  };
}
