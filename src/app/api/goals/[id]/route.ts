import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  const { id } = await params;
  const goal = await prisma.goal.findFirst({
    where: { id, userId: user.id },
    include: {
      milestones: {
        orderBy: { orderIdx: "asc" },
        include: { tasks: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!goal) return new NextResponse("Not found", { status: 404 });

  // recompute progress
  const tasks = await prisma.task.findMany({ where: { goalId: id } });
  const done = tasks.filter((t: { status: string }) => t.status === "DONE").length;
  const pct = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);
  if (pct !== goal.progressPct) {
    await prisma.goal.update({ where: { id }, data: { progressPct: pct } });
    goal.progressPct = pct;
  }

  return NextResponse.json(goal);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  const { id } = await params;
  const existing = await prisma.goal.findFirst({ where: { id, userId: user.id } });
  if (!existing) return new NextResponse("Not found", { status: 404 });
  await prisma.goal.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
