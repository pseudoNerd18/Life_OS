"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { motion } from "framer-motion";
import type { Task, CalendarEvent } from "@prisma/client";
import { cn, formatTime } from "@/lib/utils";
import { useTasks, adoptTasks } from "@/stores/tasks";
import { useCalendarEvents, adoptCalendarEvents } from "@/stores/calendar-events";
import { useAdoptedRows } from "@/lib/use-adopted-rows";
import { CalendarItemDialog, type CalendarTarget } from "@/components/calendar/event-dialog";

export function CalendarView({
  weekStart, tasks, events,
}: {
  weekStart: string;
  tasks: Task[];
  events: CalendarEvent[];
}) {
  // Hydration happens in an effect, not in this render body: MonthView shares
  // these stores and is briefly mounted alongside this component during a view
  // switch. See lib/use-adopted-rows.ts.
  const liveTasks = useAdoptedRows(tasks, useTasks((s) => s.tasks), adoptTasks);
  const liveEvents = useAdoptedRows(
    events, useCalendarEvents((s) => s.events), adoptCalendarEvents,
  );
  const [target, setTarget] = useState<CalendarTarget | null>(null);

  const start = new Date(weekStart);
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

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
    <div className="grid gap-2">
      {days.map((d, i) => {
        const { tasks: dayTasks, events: dayEvents } = itemsFor(d);
        const isToday = d.getTime() === today.getTime();
        const isPast = d < today;
        const isEmpty = dayTasks.length + dayEvents.length === 0;

        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            className={cn(
              "group/day surface shadow-soft px-5 py-4 flex gap-6",
              isPast && !isToday && "opacity-60",
            )}
          >
            <div className="w-20 shrink-0">
              <p className={cn(
                "font-display text-3xl italic leading-none",
                isToday && "text-foreground",
                !isToday && "text-muted-foreground",
              )}>
                {d.getDate()}
              </p>
              <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </p>
              {isToday && <p className="mt-2 text-xs italic">today</p>}
            </div>

            <div className="flex-1 min-w-0">
              {isEmpty ? (
                <p className="text-sm text-muted-foreground italic">—</p>
              ) : (
                <div className="space-y-2">
                  {dayEvents.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setTarget({ mode: "edit", kind: "event", event: e })}
                      className="flex items-baseline gap-3 text-sm w-full text-left rounded-md hover:bg-secondary/60 -mx-1 px-1 py-0.5 transition-colors"
                    >
                      <span className="tabular-nums text-xs text-muted-foreground w-16 shrink-0">
                        {e.allDay ? "all day" : `${formatTime(e.startAt)}`}
                      </span>
                      <span className="truncate">{e.title}</span>
                      {e.location && (
                        <span className="text-xs text-muted-foreground truncate">· {e.location}</span>
                      )}
                    </button>
                  ))}
                  {dayTasks.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTarget({ mode: "edit", kind: "task", task: t })}
                      className="flex items-baseline gap-3 text-sm w-full text-left rounded-md hover:bg-secondary/60 -mx-1 px-1 py-0.5 transition-colors"
                    >
                      <span className="tabular-nums text-xs text-muted-foreground w-16 shrink-0">
                        {t.dueAt ? formatTime(t.dueAt) : ""}
                      </span>
                      <span className={cn(
                        "truncate",
                        t.status === "DONE" && "line-through text-muted-foreground",
                      )}>
                        {t.title}
                      </span>
                      <span className="text-xs text-muted-foreground">· {t.category.toLowerCase()}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => setTarget({ mode: "create", date: d })}
              className="self-start p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground opacity-0 group-hover/day:opacity-100 transition-opacity"
              aria-label="Add event"
            >
              <Plus className="h-4 w-4" />
            </button>
          </motion.div>
        );
      })}

      <CalendarItemDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
