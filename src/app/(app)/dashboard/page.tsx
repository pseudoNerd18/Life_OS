import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { BriefingCard } from "@/components/dashboard/briefing-card";
import { TodayTasks } from "@/components/dashboard/today-tasks";
import { ActiveGoals } from "@/components/dashboard/active-goals";
import { UpcomingEvents } from "@/components/dashboard/upcoming-events";
import { QuickCapture } from "@/components/dashboard/quick-capture";
import { ReminderCalls } from "@/components/dashboard/reminder-calls";
import { dayRangeIn, hourIn, safeTz } from "@/lib/time";
import { todayScopeWhere } from "@/lib/queries";
import { getCapabilities } from "@/lib/env";

export default async function Dashboard() {
  const user = await currentUser();
  const tz = safeTz(user.timezone);
  const { start: todayStart, end: todayEnd } = dayRangeIn(tz);

  const [tasks, goals, events, callSettings] = await Promise.all([
    // Same filter the client store polls with — see todayScopeWhere.
    // Overdue tasks are included: the briefing says "start with what's
    // overdue", so they have to be visible on the list it refers to.
    prisma.task.findMany({
      where: todayScopeWhere(user.id, tz),
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
      take: 25,
    }),
    prisma.goal.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      take: 4,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.calendarEvent.findMany({
      where: { userId: user.id, startAt: { gte: todayStart, lt: todayEnd } },
      orderBy: { startAt: "asc" },
      take: 8,
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { phone: true, callReminders: true },
    }),
  ]);

  const greeting = greetingFor(hourIn(tz), user.name);

  return (
    <div className="px-6 lg:px-10 py-8 max-w-6xl mx-auto w-full">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long", month: "long", day: "numeric", timeZone: tz,
          })}
        </p>
        <h1 className="mt-1 font-display text-4xl md:text-5xl italic">{greeting}</h1>
      </header>

      <BriefingCard />

      {/* Live interim transcripts need a fast Whisper model; see useDictation. */}
      <QuickCapture liveText={Boolean(process.env.WHISPER_FAST_MODEL)} />

      <div className="mt-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <TodayTasks initial={tasks} />
        </div>
        <div className="space-y-6">
          <UpcomingEvents events={events} />
          <ReminderCalls
            initialPhone={callSettings?.phone ?? null}
            initialEnabled={callSettings?.callReminders ?? true}
            configured={getCapabilities().hasTwilio}
          />
          <ActiveGoals goals={goals} />
        </div>
      </div>
    </div>
  );
}

function greetingFor(h: number, name?: string | null) {
  const part = h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Good night";
  const first = name?.split(" ")[0];
  return first ? `${part}, ${first}.` : `${part}.`;
}
