import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { taskInputZ } from "@/lib/validation";
import { TaskSource } from "@prisma/client";
import { safeTz } from "@/lib/time";
import { todayScopeWhere } from "@/lib/queries";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await currentUser();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;
  const category = searchParams.get("category") ?? undefined;
  const scope = searchParams.get("scope") ?? undefined;

  const where =
    scope === "today"
      ? todayScopeWhere(user.id, safeTz(user.timezone))
      : {
          userId: user.id,
          ...(status ? { status: status as "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "SNOOZED" } : {}),
          ...(category ? { category: category as "WORK" | "PERSONAL" | "HEALTH" | "LEARNING" | "FINANCE" | "SOCIAL" | "HOME" | "OTHER" } : {}),
        };

  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json(tasks);
}

export async function POST(req: Request) {
  const user = await currentUser();
  const body = await req.json().catch(() => null);
  const parsed = taskInputZ.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const t = await prisma.task.create({
    data: {
      userId: user.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      status: parsed.data.status ?? "TODO",
      priority: parsed.data.priority ?? "MEDIUM",
      category: parsed.data.category ?? "OTHER",
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      startAt: parsed.data.startAt ? new Date(parsed.data.startAt) : null,
      durationMin: parsed.data.durationMin ?? null,
      remindAt: parsed.data.remindAt ? new Date(parsed.data.remindAt) : null,
      rrule: parsed.data.rrule ?? null,
      goalId: parsed.data.goalId ?? null,
      milestoneId: parsed.data.milestoneId ?? null,
      parentId: parsed.data.parentId ?? null,
      source: TaskSource.MANUAL,
    },
  });

  return NextResponse.json(t, { status: 201 });
}
