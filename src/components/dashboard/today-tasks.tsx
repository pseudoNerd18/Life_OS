"use client";
import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Task } from "@prisma/client";
import { TaskRow } from "@/components/tasks/task-row";
import { useTasks, adoptTasks } from "@/stores/tasks";
import { useAdoptedRows } from "@/lib/use-adopted-rows";

/**
 * Today's task list.
 *
 * Fixes over the previous version:
 *  1. Content-keyed hydration. `useEffect(..., [initial])` re-ran on every
 *     parent render because `initial` is a fresh array reference each server
 *     render — clobbering local edits. A render-phase `setState` guarded by a
 *     ref fixed that but broke a different rule: it updates other subscribers
 *     of the store while React is rendering this one. Both are handled by
 *     `useAdoptedRows`, which adopts in an effect and keys on row content.
 *  2. Single AnimatePresence. Previously "open" and "done" were two separate
 *     AnimatePresence trees; toggling a task between them unmounted it from one
 *     and mounted it in the other, so the exit animation never played and the
 *     row flickered. Now there's one list; a completed task animates in place.
 *  3. Poll safety. The 30s background poll is delegated to the store, which
 *     now skips the refresh while a mutation is in flight (see stores/tasks.ts)
 *     so it can't overwrite optimistic state.
 */
export function TodayTasks({ initial }: { initial: Task[] }) {
  const load = useTasks((s) => s.load);
  // Adopted in an effect rather than during render — a render-phase setState
  // updates every other subscriber of this store mid-render. Adoption is keyed
  // on the rows' content, so a parent re-render carrying the same tasks does
  // not clobber a local edit (which is what the old `[initial]` effect did).
  // See lib/use-adopted-rows.ts.
  const tasks = useAdoptedRows(initial, useTasks((s) => s.tasks), adoptTasks);

  // Poll with the same filter the server used to render `initial`. Polling the
  // unfiltered endpoint turned "Today" into "every task" after 30 seconds.
  useEffect(() => {
    const t = setInterval(() => { void load("scope=today"); }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  // One ordered list: open tasks first, then completed — but a single array,
  // so AnimatePresence + `layout` animate a status change as a smooth reorder
  // rather than an unmount/remount flicker.
  const ordered = [...tasks]
    .filter((t) => t.status !== "CANCELLED")
    .sort((a, b) => {
      const aDone = a.status === "DONE" ? 1 : 0;
      const bDone = b.status === "DONE" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      // within a group, keep stable-ish ordering by due date then creation
      const ad = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const bd = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  const openCount = ordered.filter((t) => t.status !== "DONE").length;
  const doneCount = ordered.filter((t) => t.status === "DONE").length;
  const firstDoneId = ordered.find((t) => t.status === "DONE")?.id;

  return (
    <section className="surface shadow-soft">
      <header className="px-5 pt-5 pb-2 flex items-baseline justify-between">
        <h2 className="text-base font-medium">Today</h2>
        <span className="text-xs text-muted-foreground">
          {openCount} open · {doneCount} done
        </span>
      </header>
      <div className="px-5">
        {ordered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nothing on the books — ask the assistant to add something.
          </p>
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            {ordered.map((t) => (
              <motion.div key={t.id} layout="position">
                {t.id === firstDoneId && (
                  <p className="mt-4 mb-1 text-xs text-muted-foreground">Completed</p>
                )}
                <TaskRow task={t} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
      <div className="h-5" />
    </section>
  );
}
