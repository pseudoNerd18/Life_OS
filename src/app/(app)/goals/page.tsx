import Link from "next/link";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Target } from "lucide-react";
import { NewGoal } from "@/components/goals/new-goal";

export default async function GoalsPage() {
  const user = await currentUser();

  const goals = await prisma.goal.findMany({
    where: { userId: user.id },
    include: { _count: { select: { tasks: true, milestones: true } } },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });

  return (
    <div className="px-6 lg:px-10 py-8 max-w-4xl mx-auto w-full">
      <header className="flex items-baseline justify-between mb-8">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Goals</p>
          <h1 className="mt-0.5 font-display text-3xl italic">What you&apos;re working toward.</h1>
        </div>
        <NewGoal />
      </header>

      {goals.length === 0 ? (
        <div className="surface shadow-soft p-10 text-center">
          <Target className="h-6 w-6 mx-auto text-muted-foreground" strokeWidth={1.5} />
          <p className="mt-4 font-display text-xl italic">Nothing yet.</p>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
            Tell the assistant something like &ldquo;Help me prepare for GATE in 4 months&rdquo; — it&apos;ll
            draft milestones and recurring tasks automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {goals.map((g: { id: string; title: string; description: string | null; progressPct: number; targetDate: Date | null; status: string; _count: { tasks: number; milestones: number } }) => (
            <Link
              key={g.id}
              href={`/goals/${g.id}`}
              className="surface shadow-soft p-5 block hover:shadow-lift transition-shadow"
            >
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-base">{g.title}</h3>
                <span className="text-xs tabular-nums text-muted-foreground">{g.progressPct}%</span>
              </div>
              {g.description && (
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{g.description}</p>
              )}
              <div className="mt-3 h-1 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-foreground/70 rounded-full transition-all"
                  style={{ width: `${g.progressPct}%` }}
                />
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                <span>{g._count.milestones} milestones</span>
                <span>·</span>
                <span>{g._count.tasks} tasks</span>
                {g.targetDate && (
                  <>
                    <span>·</span>
                    <span>Target {new Date(g.targetDate).toLocaleDateString()}</span>
                  </>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
