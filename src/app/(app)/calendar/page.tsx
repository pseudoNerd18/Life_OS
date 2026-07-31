import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getCapabilities } from "@/lib/env";
import { googleClientId } from "@/lib/auth/google-id-token";
import { CalendarView } from "@/components/calendar/calendar-view";
import { MonthView } from "@/components/calendar/month-view";
import { ConnectedCalendars } from "@/components/calendar/connected-calendars";
import { CalendarConnectNotice } from "@/components/calendar/connect-notice";
import { civilDateIn, dayRangeIn, monthGridRange, safeTz, weekdayIn } from "@/lib/time";
import { cn } from "@/lib/utils";

/** `YYYY-MM` → `{ year, month }` (1-based), or null if malformed. */
function parseMonthParam(m: string | undefined) {
  const match = /^(\d{4})-(\d{2})$/.exec(m ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function monthParam(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(year: number, month: number, delta: number) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ gcal?: string; detail?: string; view?: string; m?: string }>;
}) {
  const user = await currentUser();
  const { gcal, detail, view, m } = await searchParams;

  // Anchor the grid to the user's day, not the server's — otherwise the
  // fortnight is offset by the difference between the two zones.
  const tz = safeTz(user.timezone);
  const isMonth = view === "month";
  const nowCivil = civilDateIn(tz);
  const { year, month } = parseMonthParam(m) ?? { year: nowCivil.y, month: nowCivil.m };

  let start: Date;
  let end: Date;
  let grid = { startDate: "", weeks: 0 };
  if (isMonth) {
    ({ start, end, ...grid } = monthGridRange(tz, year, month));
  } else {
    const today = dayRangeIn(tz).start;
    start = new Date(today.getTime() - weekdayIn(tz) * 86_400_000); // Sunday of this week
    end = new Date(start.getTime() + 14 * 86_400_000);
  }

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });

  const [tasks, events, accounts] = await Promise.all([
    prisma.task.findMany({
      where: { userId: user.id, dueAt: { gte: start, lt: end } },
    }),
    prisma.calendarEvent.findMany({
      where: { userId: user.id, startAt: { gte: start, lt: end } },
    }),
    prisma.calendarAccount.findMany({ where: { userId: user.id } }),
  ]);

  const caps = getCapabilities();

  return (
    <div className="px-6 lg:px-10 py-8 max-w-6xl mx-auto w-full">
      <header className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Calendar</p>
          <h1 className="mt-0.5 font-display text-3xl italic">
            {isMonth ? monthLabel : "Two weeks ahead."}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {isMonth && (
            <div className="flex items-center gap-1">
              <Link
                href={`/calendar?view=month&m=${monthParam(prev.year, prev.month)}`}
                aria-label="Previous month"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <Link
                href={`/calendar?view=month&m=${monthParam(next.year, next.month)}`}
                aria-label="Next month"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          )}

          <div className="flex rounded-md border border-border p-0.5 text-xs">
            <Link
              href="/calendar"
              className={cn(
                "rounded px-2.5 py-1 transition-colors",
                isMonth ? "text-muted-foreground hover:text-foreground" : "bg-secondary text-foreground",
              )}
            >
              Fortnight
            </Link>
            <Link
              href="/calendar?view=month"
              className={cn(
                "rounded px-2.5 py-1 transition-colors",
                isMonth ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Month
            </Link>
          </div>
        </div>
      </header>

      {/* Result of an OAuth round trip, if we just came back from one. */}
      <CalendarConnectNotice status={gcal} detail={detail} />

      <div className="surface shadow-soft p-5 mb-6">
        <h2 className="text-sm font-medium mb-4">Connected calendars</h2>
        <ConnectedCalendars
          configured={caps.hasGoogleCalendar}
          googleClientId={googleClientId()}
          accounts={accounts.map((a: { id: string; provider: string; email: string; lastSyncedAt: Date | null; isActive: boolean; refreshToken: string | null; expiresAt: Date }) => ({
            id: a.id,
            provider: a.provider,
            email: a.email,
            lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
            isActive: a.isActive,
            // No refresh token means a browser grant: it expires and cannot
            // renew itself, which the UI has to say out loud.
            sessionOnly: !a.refreshToken,
            expiresAt: a.expiresAt.toISOString(),
          }))}
        />
      </div>

      {isMonth ? (
        <MonthView
          gridStart={grid.startDate}
          weeks={grid.weeks}
          month={month}
          tasks={tasks}
          events={events}
        />
      ) : (
        <CalendarView
          weekStart={start.toISOString()}
          tasks={tasks}
          events={events}
        />
      )}
    </div>
  );
}
