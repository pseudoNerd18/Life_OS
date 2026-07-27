import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { goalInputZ } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentUser();
  const goals = await prisma.goal.findMany({
    where: { userId: user.id },
    include: {
      milestones: { orderBy: { orderIdx: "asc" }, include: { tasks: { take: 5 } } },
      _count: { select: { tasks: true } },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
  return NextResponse.json(goals);
}

export async function POST(req: Request) {
  const user = await currentUser();
  const body = await req.json().catch(() => null);
  const parsed = goalInputZ.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const g = await prisma.goal.create({
    data: {
      userId: user.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      category: parsed.data.category ?? "OTHER",
      targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : null,
    },
  });
  return NextResponse.json(g, { status: 201 });
}
