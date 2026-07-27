import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { planGoal } from "@/lib/ai/planner";
import { z } from "zod";
import { rateLimitFor } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

const bodyZ = z.object({ goalId: z.string() });

export async function POST(req: Request) {
  const user = await currentUser();

  // The heaviest AI path in the app: a long synchronous generation that then
  // rewrites the goal's whole plan. Budget it tighter than chat.
  const rl = await rateLimitFor("plan", user.id);
  if (!rl.success) return NextResponse.json({ error: "Too many planning requests — try again in a minute." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = bodyZ.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const goal = await prisma.goal.findFirst({
    where: { id: parsed.data.goalId, userId: user.id },
  });
  if (!goal) return new NextResponse("Not found", { status: 404 });

  // The planner is the one AI path with no deterministic fallback, so a dead
  // Ollama must surface as a clear 503 rather than an opaque 500.
  let plan;
  try {
    plan = await planGoal({
      title: goal.title,
      description: goal.description ?? undefined,
      targetDate: goal.targetDate?.toISOString() ?? null,
      timezone: user.timezone ?? "Asia/Kolkata",
    });
  } catch (e) {
    console.error("[plan-goal] planner failed:", (e as Error).message);
    return NextResponse.json(
      {
        error: "The planner needs a local model. Start Ollama and pull the model, then try again.",
        detail: (e as Error).message,
      },
      { status: 503 },
    );
  }

  // Never wipe a working plan to replace it with nothing.
  if (!plan.milestones.length) {
    return NextResponse.json(
      { error: "The model returned no milestones. Your existing plan was left untouched." },
      { status: 502 },
    );
  }

  // Replace existing milestones + tasks for this goal.
  await prisma.$transaction([
    prisma.task.deleteMany({ where: { goalId: goal.id, source: "GOAL_PLAN" } }),
    prisma.milestone.deleteMany({ where: { goalId: goal.id } }),
    prisma.goal.update({
      where: { id: goal.id },
      data: { planRationale: plan.rationale, planVersion: { increment: 1 } },
    }),
  ]);

  for (let i = 0; i < plan.milestones.length; i++) {
    const m = plan.milestones[i];
    const milestone = await prisma.milestone.create({
      data: {
        goalId: goal.id,
        title: m.title,
        description: m.description ?? "",
        orderIdx: i,
        targetDate: m.targetDate ? new Date(m.targetDate) : null,
      },
    });
    if (m.tasks?.length) {
      await prisma.task.createMany({
        data: m.tasks.map((t) => ({
          userId: user.id,
          goalId: goal.id,
          milestoneId: milestone.id,
          title: t.title,
          description: t.description ?? null,
          category: t.category,
          priority: t.priority,
          durationMin: t.durationMin ?? null,
          rrule: t.rrule ?? null,
          source: "GOAL_PLAN" as const,
        })),
      });
    }
  }

  return NextResponse.json({ ok: true, plan });
}
