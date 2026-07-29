import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { GoalDetail } from "@/components/goals/goal-detail";

export default async function GoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();

  const goal = await prisma.goal.findFirst({
    where: { id, userId: user.id },
    include: {
      milestones: {
        orderBy: { orderIdx: "asc" },
        include: { tasks: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!goal) notFound();

  // Tightened with explicit cast because in stub-mode tsc can't infer the
  // `include`d relations from findFirst. With real Prisma client these are
  // fully inferred.
  type MilestoneWithTasks = {
    id: string; title: string; description: string | null;
    status: string; targetDate: Date | null;
    tasks: Array<{ id: string; title: string; status: string; category: string; priority: string }>;
  };
  type GoalShape = {
    id: string; title: string; description: string | null;
    progressPct: number; planRationale: string | null;
    targetDate: Date | null; milestones: MilestoneWithTasks[];
  };
  const goalWithRels = goal as GoalShape;

  // recompute progress on load
  const allTasks = goalWithRels.milestones.flatMap((m: MilestoneWithTasks) => m.tasks);
  const done = allTasks.filter((t) => t.status === "DONE").length;
  const pct = allTasks.length ? Math.round((done / allTasks.length) * 100) : 0;

  return <GoalDetail
    goal={{
      id: goalWithRels.id,
      title: goalWithRels.title,
      description: goalWithRels.description,
      progressPct: pct,
      planRationale: goalWithRels.planRationale,
      targetDate: goalWithRels.targetDate ? new Date(goalWithRels.targetDate).toISOString() : null,
      milestones: goalWithRels.milestones.map((m: MilestoneWithTasks) => ({
        id: m.id,
        title: m.title,
        description: m.description ?? "",
        status: m.status,
        targetDate: m.targetDate ? new Date(m.targetDate).toISOString() : null,
        tasks: m.tasks.map((t) => ({
          id: t.id, title: t.title, status: t.status,
          category: t.category, priority: t.priority,
        })),
      })),
    }}
  />;
}
