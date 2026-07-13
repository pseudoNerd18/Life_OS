import Link from "next/link";
import type { CalendarEvent } from "@prisma/client";
import { Calendar } from "lucide-react";
import { formatTime } from "@/lib/utils";

export function UpcomingEvents({ events }: { events: CalendarEvent[] }) {
  return (
    <section className="surface shadow-soft p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">Today&apos;s calendar</h2>
        <Link href="/calendar" className="text-xs text-muted-foreground hover:text-foreground">Open</Link>
      </div>
      {events.length === 0 ? (
        <div className="mt-5 py-6 text-center">
          <Calendar className="h-5 w-5 mx-auto text-muted-foreground" strokeWidth={1.5} />
          <p className="mt-2 text-sm text-muted-foreground">No events scheduled.</p>
          {/* This used to link to a "Connect Google Calendar" panel in Settings.
              v0.2 removed calendar OAuth, so the link went nowhere. Point at
              something that actually exists instead. */}
          <Link
            href="/assistant"
            className="mt-3 inline-block text-xs underline-offset-4 hover:underline"
          >
            Add something to your day
          </Link>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-3">
              <div className="text-xs tabular-nums text-muted-foreground w-12 pt-0.5 shrink-0">
                {e.allDay ? "all day" : formatTime(e.startAt)}
              </div>
              <div className="min-w-0">
                <p className="text-sm truncate">{e.title}</p>
                {e.location && <p className="text-xs text-muted-foreground truncate">{e.location}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
