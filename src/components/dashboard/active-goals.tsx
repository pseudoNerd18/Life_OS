import Link from "next/link";
import type { Goal } from "@prisma/client";
import { Target } from "lucide-react";

export function ActiveGoals({ goals }: { goals: Goal[] }) {
  return (
    <section className="surface shadow-soft p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">Active goals</h2>
        <Link href="/goals" className="text-xs text-muted-foreground hover:text-foreground">All</Link>
      </div>
      {goals.length === 0 ? (
        <div className="mt-5 py-6 text-center">
          <Target className="h-5 w-5 mx-auto text-muted-foreground" strokeWidth={1.5} />
          <p className="mt-2 text-sm text-muted-foreground">No active goals.</p>
          <Link
            href="/assistant"
            className="mt-3 inline-block text-xs underline-offset-4 hover:underline"
          >
            Tell the assistant what you&apos;re working on
          </Link>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {goals.map((g) => (
            <li key={g.id}>
              <Link href={`/goals/${g.id}`} className="block group">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm group-hover:text-foreground truncate">{g.title}</p>
                  <span className="text-xs text-muted-foreground tabular-nums">{g.progressPct}%</span>
                </div>
                <div className="mt-1.5 h-1 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-foreground/70 rounded-full transition-all"
                    style={{ width: `${g.progressPct}%` }}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
