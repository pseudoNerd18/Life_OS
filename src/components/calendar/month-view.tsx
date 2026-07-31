"use client";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { motion } from "framer-motion";
import type { Task, CalendarEvent } from "@prisma/client";
import { cn, formatTime } from "@/lib/utils";
import { useTasks, adoptTasks } from "@/stores/tasks";
import { useCalendarEvents, adoptCalendarEvents } from "@/stores/calendar-events";
import { useAdoptedRows } from "@/lib/use-adopted-rows";
import { CalendarItemDialog, type CalendarTarget } from "@/components/calendar/event-dialog";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** How many items fit in a cell before we collapse the rest into "+n more". */
const MAX_VISIBLE = 3;

export function MonthView({
  gridStart, weeks, month, tasks, events,
}: {
  /**
   * `YYYY-MM-DD` of the first cell — the Sunday on or before the 1st, as a
   * civil date in the user's zone. A plain date rather than an instant so the
   * grid resolves identically on the server and in the browser.
   */
  gridStart: string;
  /** Rows in the grid — 4 to 6, depending on how the month falls. */
  weeks: number;
  /** 1-based month the grid belongs to; days outside it render dimmed. */
  month: number;
  tasks: Task[];
  events: CalendarEvent[];
}) {
  // Hydration happens in an effect, not in this render body: CalendarView
  // shares these stores and is briefly mounted alongside this component during
  // a view switch. See lib/use-adopted-rows.ts.
  const liveTasks = useAdoptedRows(tasks, useTasks((s) => s.tasks), adoptTasks);
  const liveEvents = useAdoptedRows(
    events, useCalendarEvents((s) => s.events), adoptCalendarEvents,
  );
  const [target, setTarget] = useState<CalendarTarget | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const cells = useMemo(() => {
    const [y, m, d0] = gridStart.split("-").map(Number);
    return Array.from({ length: weeks * 7 }, (_, i) => new Date(y, m - 1, d0 + i));
  }, [gridStart, weeks]);

  function itemsFor(d: Date) {
    const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const t = liveTasks.filter((t) => {
      if (!t.dueAt) return false;
      const dt = new Date(t.dueAt);
      return dt >= dayStart && dt < dayEnd;
    });
    const e = liveEvents.filter((e) => {
      const dt = new Date(e.startAt);
      return dt >= dayStart && dt < dayEnd;
    });
    return { tasks: t, events: e };
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);

  return (
    <div className="surface shadow-soft overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-2 text-center text-xs uppercase tracking-wider text-muted-foreground">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const { tasks: dayTasks, events: dayEvents } = itemsFor(d);
          const key = d.toDateString();
          const isToday = d.getTime() === today.getTime();
          const isOutside = d.getMonth() + 1 !== month;
          const isOpen = expanded === key;
          const items = [
            ...dayEvents.map((e) => ({ kind: "event" as const, id: e.id, event: e })),
            ...dayTasks.map((t) => ({ kind: "task" as const, id: t.id, task: t })),
          ];
          const visible = isOpen ? items : items.slice(0, MAX_VISIBLE);
          const hidden = items.length - visible.length;

          return (
            <motion.div
              key={key}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.004 }}
              className={cn(
                "group/day relative min-h-28 border-b border-r border-border p-1.5",
                i % 7 === 6 && "border-r-0",
                isOutside && "bg-secondary/25",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn(
                  "tabular-nums text-xs",
                  isToday && "flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground",
                  !isToday && (isOutside ? "text-muted-foreground/60 px-1" : "text-muted-foreground px-1"),
                )}>
                  {d.getDate()}
                </span>
                <button
                  onClick={() => setTarget({ mode: "create", date: d })}
                  className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover/day:opacity-100"
                  aria-label={`Add event on ${d.toDateString()}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-1 space-y-0.5">
                {visible.map((item) =>
                  item.kind === "event" ? (
                    <button
                      key={`e-${item.id}`}
                      onClick={() => setTarget({ mode: "edit", kind: "event", event: item.event })}
                      title={item.event.title}
                      className="flex w-full items-baseline gap-1 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-secondary"
                    >
                      {!item.event.allDay && (
                        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                          {formatTime(item.event.startAt)}
                        </span>
                      )}
                      <span className="truncate">{item.event.title}</span>
                    </button>
                  ) : (
                    <button
                      key={`t-${item.id}`}
                      onClick={() => setTarget({ mode: "edit", kind: "task", task: item.task })}
                      title={item.task.title}
                      className="flex w-full items-baseline gap-1 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-secondary"
                    >
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                      <span className={cn(
                        "truncate",
                        item.task.status === "DONE" && "line-through text-muted-foreground",
                      )}>
                        {item.task.title}
                      </span>
                    </button>
                  ),
                )}

                {(hidden > 0 || isOpen) && (
                  <button
                    onClick={() => setExpanded(isOpen ? null : key)}
                    className="px-1 text-[10px] italic text-muted-foreground hover:text-foreground"
                  >
                    {isOpen ? "less" : `+${hidden} more`}
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      <CalendarItemDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
