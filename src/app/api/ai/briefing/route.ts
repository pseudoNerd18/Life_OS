import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { ollamaChat } from "@/lib/ai/ollama";
import { getCapabilities } from "@/lib/env";
import { BRIEFING_SYSTEM, briefingPrompt } from "@/lib/ai/prompts";
import { dateKeyIn, dayRangeIn, safeTz } from "@/lib/time";
import { rateLimitFor } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentUser();

  const rl = await rateLimitFor("briefing", user.id);
  if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const tz = safeTz(user.timezone);

  // "Today" means the user's today, and `forDate` is a `date` column, so the
  // key has to be UTC midnight of that calendar day — see lib/time.ts.
  const { start: todayStart, end: todayEnd } = dayRangeIn(tz);
  const dateKey = dateKeyIn(tz);
  const existing = await prisma.dailyBriefing.findUnique({
    where: { userId_forDate: { userId: user.id, forDate: dateKey } },
  });
  if (existing) return NextResponse.json(existing);

  // Collect context
  const [todayTasks, overdueTasks, events, goals] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId: user.id,
        status: { in: ["TODO", "IN_PROGRESS"] },
        dueAt: { gte: todayStart, lt: todayEnd },
      },
      take: 20,
    }),
    prisma.task.findMany({
      where: {
        userId: user.id,
        status: { in: ["TODO", "IN_PROGRESS"] },
        dueAt: { lt: todayStart },
      },
      take: 10,
      orderBy: { dueAt: "asc" },
    }),
    prisma.calendarEvent.findMany({
      where: {
        userId: user.id,
        startAt: { gte: todayStart, lt: todayEnd },
      },
      take: 10,
      orderBy: { startAt: "asc" },
    }),
    prisma.goal.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      take: 5,
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  let payload: { summary: string; focusAreas: string[] } = {
    summary: "Quiet day ahead.",
    focusAreas: [],
  };

  if (getCapabilities().hasOllama) {
    try {
      const raw = await ollamaChat({
        system: BRIEFING_SYSTEM,
        prompt: briefingPrompt({
          now: new Date().toLocaleString("en-IN", { timeZone: tz }),
          tz,
          today: todayTasks.map((t: { title: string; dueAt: Date | null; category: string }) => ({
            title: t.title,
            dueAt: t.dueAt?.toISOString(),
            category: t.category,
          })),
          overdue: overdueTasks.map((t: { title: string; dueAt: Date | null }) => ({
            title: t.title,
            daysLate: Math.round(((todayStart.getTime() - (t.dueAt?.getTime() ?? 0)) / 86_400_000)),
          })),
          events: events.map((e: { title: string; startAt: Date }) => ({ title: e.title, startAt: e.startAt.toISOString() })),
          goals: goals.map((g: { title: string; progressPct: number }) => ({ title: g.title, progressPct: g.progressPct })),
        }),
        format: "json",
        temperature: 0.3,
      });
      const json = JSON.parse(raw);
      if (json.summary) payload = { summary: json.summary, focusAreas: json.focusAreas ?? [] };
    } catch {
      // fall through to deterministic summary below
    }
  }

  // Deterministic fallback summary (also covers the no-Ollama case).
  if (payload.summary === "Quiet day ahead." && (todayTasks.length || overdueTasks.length || events.length)) {
    const bits: string[] = [];
    if (overdueTasks.length) bits.push(`${overdueTasks.length} overdue`);
    if (todayTasks.length) bits.push(`${todayTasks.length} due today`);
    if (events.length) bits.push(`${events.length} on the calendar`);
    payload = {
      summary: `You have ${bits.join(", ")}. ${overdueTasks.length ? "Start with what's overdue." : "A manageable day."}`,
      focusAreas: goals.slice(0, 2).map((g: { title: string }) => g.title),
    };
  }

  const briefing = await prisma.dailyBriefing.create({
    data: {
      userId: user.id,
      forDate: dateKey,
      summary: payload.summary,
      focusAreas: payload.focusAreas,
      overdueCount: overdueTasks.length,
      upcomingCount: todayTasks.length + events.length,
    },
  });

  return NextResponse.json(briefing);
}
