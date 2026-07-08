import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await currentUser();

  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  const from = fromStr ? new Date(fromStr) : new Date(Date.now() - 7 * 86_400_000);
  const to   = toStr   ? new Date(toStr)   : new Date(Date.now() + 30 * 86_400_000);

  const [tasks, events] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId: user.id,
        dueAt: { gte: from, lte: to },
      },
      select: { id: true, title: true, dueAt: true, durationMin: true, category: true, status: true, priority: true },
      orderBy: { dueAt: "asc" },
    }),
    prisma.calendarEvent.findMany({
      where: {
        userId: user.id,
        startAt: { gte: from, lte: to },
      },
      select: { id: true, title: true, startAt: true, endAt: true, location: true, allDay: true },
      orderBy: { startAt: "asc" },
    }),
  ]);

  return NextResponse.json({ tasks, events });
}
