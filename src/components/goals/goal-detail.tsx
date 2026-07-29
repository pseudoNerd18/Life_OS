"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Loader2, Check, Lock } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface GoalShape {
  id: string;
  title: string;
  description: string | null;
  progressPct: number;
  planRationale: string | null;
  targetDate: string | null;
  milestones: Array<{
    id: string;
    title: string;
    description: string;
    status: string;
    targetDate: string | null;
    tasks: Array<{
      id: string;
      title: string;
      status: string;
      category: string;
      priority: string;
    }>;
  }>;
}

/** Index of the first milestone still closed — everything from here down is locked. */
function lockBoundary(milestones: Array<{ tasks: Array<{ status: string }> }>): number {
  // A milestone counts as reached when every task under it is ticked. Derived
  // from the tasks rather than read from `Milestone.status`, because nothing in
  // the app maintains that column — the same reason the page recomputes
  // progress from tasks on load. A milestone with no tasks can never be ticked
  // off, so it is treated as reached: otherwise it would gate the rest forever.
  const reached = milestones.map(
    (m) => m.tasks.length === 0 || m.tasks.every((t) => t.status === "DONE"),
  );
  // The first milestone is always open; each later one opens only once
  // everything above it is done, so the plan reveals itself a step at a time.
  // With every milestone reached, `findIndex` returns -1 and nothing is locked.
  const firstUnreached = reached.findIndex((done) => !done);
  return firstUnreached === -1 ? milestones.length : firstUnreached + 1;
}

export function GoalDetail({ goal }: { goal: GoalShape }) {
  const router = useRouter();
  const [planning, setPlanning] = useState(false);

  const setStatus = (id: string, status: string) =>
    fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });

  async function toggleTask(id: string, currentStatus: string, locked: boolean) {
    if (locked) return;
    const next = currentStatus === "DONE" ? "TODO" : "DONE";
    await setStatus(id, next);

    // Did this tick open a section that was closed? A section can be carrying
    // ticks from before it was locked — or from a planner that pre-marked them
    // — and revealing half-finished work would misread as progress the user
    // never made. Anything that opens, opens as a clean slate.
    const after = goal.milestones.map((m) => ({
      ...m,
      tasks: m.tasks.map((t) => (t.id === id ? { ...t, status: next } : t)),
    }));
    const opened = after.slice(lockedFrom, lockBoundary(after));
    const stale = opened.flatMap((m) => m.tasks.filter((t) => t.status === "DONE"));
    if (stale.length) await Promise.all(stale.map((t) => setStatus(t.id, "TODO")));

    router.refresh();
  }

  async function replan() {
    setPlanning(true);
    try {
      const res = await fetch("/api/ai/plan-goal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goalId: goal.id }),
      });
      if (!res.ok) {
        // The server explains *why* (e.g. Ollama is not running) — showing a
        // generic "Planning failed" throws away the only actionable detail.
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Planning failed (${res.status})`);
      }
      toast("Plan regenerated.");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message || "Planning failed");
    } finally {
      setPlanning(false);
    }
  }

  const lockedFrom = lockBoundary(goal.milestones);

  return (
    <div className="px-6 lg:px-10 py-8 max-w-4xl mx-auto w-full">
      <Link href="/goals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="h-3.5 w-3.5" /> All goals
      </Link>

      <header className="mb-8">
        <h1 className="font-display text-4xl italic">{goal.title}</h1>
        {goal.description && (
          <p className="mt-2 text-muted-foreground">{goal.description}</p>
        )}
        <div className="mt-5 flex items-center gap-3">
          <div className="flex-1 max-w-xs h-1.5 rounded-full bg-secondary overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${goal.progressPct}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="h-full bg-foreground/70"
            />
          </div>
          <span className="text-sm tabular-nums">{goal.progressPct}%</span>
          {goal.targetDate && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-sm text-muted-foreground">
                target {new Date(goal.targetDate).toLocaleDateString()}
              </span>
            </>
          )}
          <Button onClick={replan} size="sm" variant="outline" className="ml-auto" disabled={planning}>
            {planning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Re-plan
          </Button>
        </div>
      </header>

      {goal.planRationale && (
        <div className="surface-soft p-4 mb-8 text-sm italic text-muted-foreground">
          {goal.planRationale}
        </div>
      )}

      {goal.milestones.length === 0 ? (
        <div className="surface shadow-soft p-8 text-center text-sm text-muted-foreground">
          The planner hasn&apos;t produced milestones yet. Click <em>Re-plan</em> to draft one.
        </div>
      ) : (
        <ol className="relative border-l border-border pl-6 ml-2 space-y-8">
          {goal.milestones.map((m, i) => {
            const locked = i >= lockedFrom;
            const blocker = locked ? goal.milestones[i - 1] : null;

            return (
              <li key={m.id} className="relative">
                {locked ? (
                  <span className="absolute -left-[34px] top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-background bg-muted">
                    <Lock className="h-2.5 w-2.5 text-muted-foreground" />
                  </span>
                ) : (
                  <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-background bg-foreground/40" />
                )}

                <div className="flex items-baseline justify-between gap-3">
                  <h3 className={cn("text-lg", locked && "text-muted-foreground")}>{m.title}</h3>
                  {m.targetDate && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(m.targetDate).toLocaleDateString()}
                    </span>
                  )}
                </div>

                {locked ? (
                  <p className="mt-1 text-sm text-muted-foreground/80">
                    {m.tasks.length} {m.tasks.length === 1 ? "step" : "steps"} · opens once{" "}
                    <span className="italic">{blocker?.title}</span> is complete
                  </p>
                ) : (
                  <>
                    {m.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>
                    )}
                    <ul className="mt-3 space-y-1">
                      {m.tasks.map((t) => (
                        <li key={t.id}>
                          <button
                            onClick={() => toggleTask(t.id, t.status, locked)}
                            className="w-full text-left flex items-center gap-3 py-1.5 group"
                          >
                            <span className={cn(
                              "h-4 w-4 rounded border flex items-center justify-center transition-colors",
                              t.status === "DONE"
                                ? "bg-primary border-primary"
                                : "border-border group-hover:border-foreground",
                            )}>
                              {t.status === "DONE" && (
                                <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
                              )}
                            </span>
                            <span className={cn(
                              "text-sm flex-1",
                              t.status === "DONE" && "text-muted-foreground line-through",
                            )}>
                              {t.title}
                            </span>
                            <Badge variant={t.priority === "HIGH" ? "high" : t.priority === "LOW" ? "low" : "med"}>
                              {t.priority.toLowerCase()}
                            </Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
