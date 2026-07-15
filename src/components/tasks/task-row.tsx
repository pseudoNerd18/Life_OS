"use client";
import { useState } from "react";
import { Trash2, Clock, Calendar as CalendarIcon } from "lucide-react";
import { motion } from "framer-motion";
import type { Task } from "@prisma/client";
import { Checkbox } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/badge";
import { useTasks } from "@/stores/tasks";
import { cn, formatRelativeDay, formatTime } from "@/lib/utils";

const priorityVariant = {
  LOW: "low", MEDIUM: "med", HIGH: "high", URGENT: "high",
} as const;

const categoryLabel: Record<string, string> = {
  WORK: "Work", PERSONAL: "Personal", HEALTH: "Health",
  LEARNING: "Learning", FINANCE: "Finance", SOCIAL: "Social",
  HOME: "Home", OTHER: "Other",
};

export function TaskRow({ task }: { task: Task }) {
  const toggle = useTasks((s) => s.toggleDone);
  const remove = useTasks((s) => s.remove);
  const [hover, setHover] = useState(false);
  const done = task.status === "DONE";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="group flex items-start gap-3 py-3 px-1 border-b border-border last:border-0"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Checkbox
        checked={done}
        onCheckedChange={() => toggle(task.id)}
        className="mt-0.5"
        aria-label={`Mark ${task.title} ${done ? "incomplete" : "complete"}`}
      />
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm leading-snug truncate", done && "text-muted-foreground line-through")}>
          {task.title}
        </p>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={priorityVariant[task.priority]}>{task.priority.toLowerCase()}</Badge>
          <span>{categoryLabel[task.category] ?? task.category}</span>
          {task.dueAt && (
            <span className="inline-flex items-center gap-1">
              <CalendarIcon className="h-3 w-3" />
              {formatRelativeDay(task.dueAt)}
              {(() => {
                const d = new Date(task.dueAt);
                const hasTime = d.getHours() + d.getMinutes() !== 0;
                return hasTime ? <span>· {formatTime(task.dueAt)}</span> : null;
              })()}
            </span>
          )}
          {task.durationMin && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {task.durationMin}m
            </span>
          )}
          {task.rrule && <span className="italic">recurring</span>}
        </div>
      </div>
      <button
        onClick={() => remove(task.id)}
        className={cn(
          "p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-all",
          hover ? "opacity-100" : "opacity-0",
        )}
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}
