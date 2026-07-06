/**
 * Demo data — eight weeks of a life, so the app looks lived in.
 *
 * What it writes: task history with real completion streaks, recurring habits
 * with materialised past occurrences, goals whose progress matches their
 * milestone tasks, cross-linked notes, a repeating calendar week, assistant
 * conversations, semantic memories, notifications, and a run of daily
 * briefings. The content itself lives in `seed-data.ts`.
 *
 * Target: whoever is actually browsing. Sign-in is required, so the default is
 * the newest real account (one with an email); guests and test rows are
 * skipped. Override with SEED_USER_ID.
 *
 *   npm run dev            # sign in once
 *   npm run db:seed
 *
 * Idempotent by construction: every row it writes carries a marker it can find
 * again (`Task.sourceRef = "seed"`, a known title, a known content string), so
 * a re-run replaces the demo data and leaves anything you created alone.
 */
import {
  PrismaClient, Priority, Category, TaskStatus, TaskSource,
  GoalStatus, MilestoneStatus, MessageRole, NotificationType,
} from "@prisma/client";
import * as D from "./seed-data";

const prisma = new PrismaClient();

/** How far back the activity log goes. */
const HISTORY_DAYS = 56;

// ─────────────────────────────────────────────────────────────
// Deterministic randomness — a re-run produces the same database,
// which matters when you are comparing screenshots.
// ─────────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x11feed);

/** Integer in [lo, hi]. */
const intBetween = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const chance = (p: number) => rand() < p;

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Draws without replacement, reshuffling once the pool runs dry. */
function drawer<T>(items: T[]) {
  let queue = shuffled(items);
  return (): T => {
    if (!queue.length) queue = shuffled(items);
    return queue.pop()!;
  };
}

// ─────────────────────────────────────────────────────────────
// Dates. Everything is built as a wall-clock time in the user's
// zone and stored as the real instant — the same rule lib/time.ts
// enforces at read time. Building these from the server's local
// clock would put "due today" on the wrong day for a user in a
// different zone from the machine running the seed.
// ─────────────────────────────────────────────────────────────

function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour"), get("minute"), get("second"),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

function makeClock(tz: string) {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [ty, tm, td] = iso.split("-").map(Number);

  /** UTC instant of `hh:mm` on the civil date `dayOffset` days from today. */
  function at(dayOffset: number, hh = 0, mm = 0): Date {
    const civil = new Date(Date.UTC(ty, tm - 1, td + dayOffset));
    const naive = Date.UTC(
      civil.getUTCFullYear(), civil.getUTCMonth(), civil.getUTCDate(), hh, mm, 0, 0,
    );
    // Two passes so a zone change landing on the same day still resolves.
    let inst = new Date(naive - tzOffsetMinutes(tz, new Date(naive)) * 60_000);
    inst = new Date(naive - tzOffsetMinutes(tz, inst) * 60_000);
    return inst;
  }

  /** UTC midnight of that civil date — what a Postgres `date` column wants. */
  function dateKey(dayOffset: number): Date {
    const civil = new Date(Date.UTC(ty, tm - 1, td + dayOffset));
    return new Date(Date.UTC(civil.getUTCFullYear(), civil.getUTCMonth(), civil.getUTCDate()));
  }

  /** Weekday of that day, 0 = Sunday. */
  function weekday(dayOffset: number): number {
    return new Date(Date.UTC(ty, tm - 1, td + dayOffset)).getUTCDay();
  }

  return { at, dateKey, weekday };
}

type Clock = ReturnType<typeof makeClock>;

// ─────────────────────────────────────────────────────────────
// Target account
// ─────────────────────────────────────────────────────────────

/**
 * Which wall clock the demo data is written against.
 *
 * The account's `timezone` is the app's own source of truth for "the user's
 * day", so that is the default. It matters that it matches the browser you
 * will look at this in: server-side day bucketing uses the stored zone, but
 * `formatTime` renders in the *browser's* zone, so a mismatch shows up as
 * evening tasks displayed at 2am. SEED_TZ overrides it.
 */
function resolveZone(stored: string | null | undefined): string {
  const override = process.env.SEED_TZ;
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const pick = override || stored || local || "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: pick });
  } catch {
    console.warn(`· "${pick}" is not a valid zone — falling back to ${local}`);
    return local;
  }

  if (!override && pick !== local) {
    console.warn(
      `· account zone is ${pick} but this machine is ${local}.\n`
      + `  Times will read correctly in a ${pick} browser. If you browse from ${local},\n`
      + `  either set the zone in Settings or re-run with SEED_TZ=${local}.`,
    );
  }
  return pick;
}

async function resolveUser() {
  const explicit = process.env.SEED_USER_ID;
  if (explicit) {
    const u = await prisma.user.findUnique({ where: { id: explicit } });
    if (!u) throw new Error(`SEED_USER_ID=${explicit} does not exist`);
    return { user: u, how: "SEED_USER_ID" };
  }

  // Sign-in is required, so a real account has an email. Guests and the rows
  // left behind by smoke tests do not, and seeding those helps nobody.
  const real = await prisma.user.findFirst({
    where: { email: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (real) return { user: real, how: "newest signed-in account" };

  const demo = await prisma.user.upsert({
    where: { email: "demo@lifeos.local" },
    update: {},
    create: {
      email: "demo@lifeos.local", name: "Demo User",
      onboardedAt: new Date(), timezone: "Asia/Kolkata",
    },
  });
  return { user: demo, how: "fallback demo user" };
}

/** Vector similarity search needs an index once Memory grows past a few rows. */
async function ensureVectorIndex() {
  try {
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "Memory_embedding_hnsw"
         ON "Memory" USING hnsw (embedding vector_cosine_ops)`,
    );
  } catch (e) {
    console.warn("· skipped HNSW index:", (e as Error).message.split("\n")[0]);
  }
}

// ─────────────────────────────────────────────────────────────
// Cleanup — remove exactly what a previous run wrote.
// ─────────────────────────────────────────────────────────────

const SEED_REF = "seed";

async function clearPreviousSeed(userId: string, clock: Clock) {
  // Titles the current corpus writes, plus the ones earlier versions of it
  // wrote. Without the retired lists, shrinking the corpus would strand the
  // rows a previous run created — nothing would name them any more, so nothing
  // would delete them, and the demo would keep growing across re-seeds.
  const goalTitles = [...D.GOALS.map((g) => g.title), ...D.RETIRED_GOAL_TITLES];
  const noteTitles = [...D.NOTES.map((n) => n.title), ...D.RETIRED_NOTE_TITLES];
  const eventTitles = [
    ...new Set([
      ...D.WEEKLY_EVENTS.map((e) => e.title),
      ...D.ONE_OFF_EVENTS.map((e) => e.title),
      ...D.RETIRED_EVENT_TITLES,
    ]),
  ];

  // Tasks first: they hold the FKs into goals and milestones.
  await prisma.task.deleteMany({ where: { userId, sourceRef: SEED_REF } });
  await prisma.goal.deleteMany({ where: { userId, title: { in: goalTitles } } });
  // NoteLink rows cascade from either side.
  await prisma.note.deleteMany({ where: { userId, title: { in: noteTitles } } });
  await prisma.conversation.deleteMany({
    where: {
      userId,
      title: { in: [...D.CONVERSATIONS.map((c) => c.title), ...D.RETIRED_CONVERSATION_TITLES] },
    },
  });
  await prisma.memory.deleteMany({
    where: {
      userId,
      content: { in: [...D.MEMORIES.map((m) => m.content), ...D.RETIRED_MEMORY_CONTENTS] },
    },
  });
  await prisma.notification.deleteMany({
    where: {
      userId,
      title: {
        in: [...new Set([...D.NOTIFICATIONS.map((n) => n.title), ...D.RETIRED_NOTIFICATION_TITLES])],
      },
    },
  });
  await prisma.dailyBriefing.deleteMany({
    where: { userId, forDate: { in: D.BRIEFING_DAYS.map((d) => clock.dateKey(-d)) } },
  });
  // Local events only — anything with an accountId came from a real calendar
  // and is none of our business.
  await prisma.calendarEvent.deleteMany({
    where: {
      userId, accountId: null, syncedAt: null,
      title: { in: eventTitles },
      startAt: { gte: clock.at(-HISTORY_DAYS), lt: clock.at(120) },
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────

type TaskCreate = NonNullable<Parameters<typeof prisma.task.createMany>[0]>["data"];

/** Every seeded task goes through here, so the marker is never forgotten. */
function taskRow(userId: string, row: Record<string, unknown>) {
  return { userId, sourceRef: SEED_REF, ...row } as never;
}

/**
 * The past. Two to four things a weekday, fewer at weekends, all of them
 * closed out — a historical row left open would land on today's list and the
 * dashboard would read as a backlog of eight weeks rather than a working log.
 */
async function seedHistory(userId: string, clock: Clock) {
  const draw = drawer(D.HISTORY_POOL);
  const rows: Array<Record<string, unknown>> = [];

  // Chores repeat, but not every week — remember when each was last done.
  const lastChore = new Map<string, number>();

  for (let day = -HISTORY_DAYS; day <= -1; day++) {
    const wd = clock.weekday(day);
    const weekend = wd === 0 || wd === 6;
    const count = weekend ? intBetween(0, 2) : intBetween(2, 4);

    for (let i = 0; i < count; i++) {
      const t = draw();
      const hour = Math.max(6, Math.min(23, (t.hour ?? 18) + intBetween(-1, 1)));
      const completedAt = clock.at(day, hour, intBetween(0, 59));
      // Things get created a little before they get done.
      const createdAt = clock.at(day - intBetween(0, 9), intBetween(8, 22), intBetween(0, 59));

      rows.push({
        title: t.title,
        description: t.description ?? null,
        category: Category[t.category],
        priority: Priority[t.priority ?? "MEDIUM"],
        durationMin: t.durationMin ?? null,
        status: TaskStatus.DONE,
        dueAt: clock.at(day, t.hour ?? 18),
        completedAt,
        createdAt,
        updatedAt: completedAt,
        source: chance(0.28) ? TaskSource.CHAT : chance(0.2) ? TaskSource.VOICE : TaskSource.MANUAL,
      });
    }

    for (const chore of D.CHORE_POOL) {
      const gap = day - (lastChore.get(chore.title) ?? -999);
      if (gap < intBetween(9, 18) || !chance(0.35)) continue;
      lastChore.set(chore.title, day);
      const completedAt = clock.at(day, chore.hour ?? 19, intBetween(0, 59));
      rows.push({
        title: chore.title,
        category: Category[chore.category],
        priority: Priority[chore.priority ?? "LOW"],
        durationMin: chore.durationMin ?? null,
        status: TaskStatus.DONE,
        dueAt: clock.at(day, chore.hour ?? 19),
        completedAt, createdAt: clock.at(day - intBetween(1, 4), 20), updatedAt: completedAt,
        source: TaskSource.MANUAL,
      });
    }
  }

  await prisma.task.createMany({ data: rows.map((r) => taskRow(userId, r)) as TaskCreate });
  return rows.length;
}

/**
 * Recurring habits. The parent carries the RRULE and points at its next
 * occurrence; past occurrences are real child rows, which is what turns a
 * rule into a visible streak. Missed days are either absent or cancelled —
 * never left open, for the same reason as the history above.
 */
async function seedHabits(userId: string, clock: Clock) {
  let children = 0;

  for (const habit of D.HABITS) {
    // Next occurrence on or after today, so the parent is never overdue.
    let nextDay = 0;
    while (!habit.days.includes(clock.weekday(nextDay))) nextDay++;

    const parent = await prisma.task.create({
      data: taskRow(userId, {
        title: habit.title,
        category: Category[habit.category],
        priority: Priority[habit.priority],
        durationMin: habit.durationMin ?? null,
        rrule: habit.rrule,
        dueAt: clock.at(nextDay, habit.hour, habit.minute ?? 0),
        remindAt: clock.at(nextDay, habit.hour, habit.minute ?? 0),
        status: TaskStatus.TODO,
        source: TaskSource[habit.source],
        createdAt: clock.at(-HISTORY_DAYS + intBetween(0, 6), 21),
        updatedAt: clock.at(-intBetween(1, 5), 21),
      }),
    });

    const rows: Array<Record<string, unknown>> = [];
    for (let day = -HISTORY_DAYS; day <= -1; day++) {
      if (!habit.days.includes(clock.weekday(day))) continue;
      const slot = clock.at(day, habit.hour, habit.minute ?? 0);

      if (chance(habit.hitRate)) {
        const completedAt = new Date(slot.getTime() + intBetween(-15, 50) * 60_000);
        rows.push({
          title: habit.title,
          category: Category[habit.category],
          priority: Priority[habit.priority],
          durationMin: habit.durationMin ?? null,
          status: TaskStatus.DONE,
          dueAt: slot, completedAt,
          recurrenceParentId: parent.id,
          source: TaskSource[habit.source],
          createdAt: slot, updatedAt: completedAt,
        });
      } else if (chance(0.3)) {
        // A skipped day that was consciously written off.
        rows.push({
          title: habit.title,
          category: Category[habit.category],
          priority: Priority[habit.priority],
          status: TaskStatus.CANCELLED,
          dueAt: slot,
          recurrenceParentId: parent.id,
          source: TaskSource[habit.source],
          createdAt: slot, updatedAt: new Date(slot.getTime() + 3600_000),
        });
      }
    }

    await prisma.task.createMany({ data: rows.map((r) => taskRow(userId, r)) as TaskCreate });
    children += rows.length;
  }

  return children;
}

/** Today, the overdue tail, and the next three weeks. */
async function seedCurrentTasks(userId: string, clock: Clock) {
  const dated = [...D.OVERDUE_TASKS, ...D.TODAY_TASKS, ...D.UPCOMING_TASKS];
  const rows = dated.map((t) => {
    const dueAt = clock.at(t.day, t.hour ?? 18, 0);
    const status = TaskStatus[t.status ?? "TODO"];
    return {
      title: t.title,
      description: t.description ?? null,
      category: Category[t.category],
      priority: Priority[t.priority ?? "MEDIUM"],
      durationMin: t.durationMin ?? null,
      dueAt,
      startAt: t.durationMin ? dueAt : null,
      remindAt: t.remindBeforeH ? new Date(dueAt.getTime() - t.remindBeforeH * 3600_000) : null,
      status,
      completedAt: status === TaskStatus.DONE ? new Date(dueAt.getTime() + intBetween(-40, 20) * 60_000) : null,
      source: TaskSource[t.source ?? "MANUAL"],
      createdAt: clock.at(t.day - intBetween(1, 12), intBetween(9, 22)),
      updatedAt: clock.at(-intBetween(0, 3), intBetween(9, 22)),
    };
  });

  // The backlog: no date, and that is the point — these are the rows the
  // dashboard shows under "no due date" and the assistant nags about.
  for (const b of D.BACKLOG_TASKS) {
    rows.push({
      title: b.title, description: null,
      category: Category[b.category], priority: Priority[b.priority ?? "LOW"],
      durationMin: null, dueAt: null, startAt: null, remindAt: null,
      status: TaskStatus.TODO, completedAt: null, source: TaskSource.CHAT,
      createdAt: clock.at(-intBetween(30, 50), 22), updatedAt: clock.at(-intBetween(20, 40), 22),
    } as never);
  }

  await prisma.task.createMany({ data: rows.map((r) => taskRow(userId, r)) as TaskCreate });

  // A parent with subtasks. Open children get a due date of their own so they
  // sit under the parent rather than in today's undated pile.
  const tree = D.SUBTASK_TREE;
  const parent = await prisma.task.create({
    data: taskRow(userId, {
      title: tree.parent.title,
      description: tree.parent.description,
      category: Category[tree.parent.category],
      priority: Priority[tree.parent.priority],
      durationMin: tree.parent.durationMin,
      dueAt: clock.at(tree.parent.day, tree.parent.hour),
      status: TaskStatus.IN_PROGRESS,
      source: TaskSource.MANUAL,
      createdAt: clock.at(-18, 15), updatedAt: clock.at(0, 11),
    }),
  });

  await prisma.task.createMany({
    data: tree.children.map((c, i) => taskRow(userId, {
      title: c.title,
      parentId: parent.id,
      category: Category[tree.parent.category],
      priority: Priority.MEDIUM,
      durationMin: c.durationMin ?? null,
      status: c.done ? TaskStatus.DONE : TaskStatus.TODO,
      dueAt: clock.at(c.done ? -intBetween(2, 9) : tree.parent.day - (tree.children.length - i), 18),
      completedAt: c.done ? clock.at(-intBetween(2, 9), intBetween(14, 21)) : null,
      source: TaskSource.MANUAL,
      createdAt: clock.at(-18, 15),
      updatedAt: clock.at(-intBetween(0, 8), 17),
    })) as TaskCreate,
  });

  return rows.length + 1 + tree.children.length;
}

// ─────────────────────────────────────────────────────────────
// Goals
// ─────────────────────────────────────────────────────────────

/**
 * When work of each kind actually gets done, so a goal's tasks don't all land
 * at the same hour. Runs are early, study is late, work is in the day.
 */
const GOAL_TASK_HOURS: Record<string, [number, number]> = {
  LEARNING: [19, 22],
  HEALTH: [6, 8],
  WORK: [11, 18],
  FINANCE: [19, 21],
  PERSONAL: [21, 23],
  SOCIAL: [18, 21],
  HOME: [17, 20],
  OTHER: [10, 20],
};

/**
 * Goals, their milestones, and the tasks underneath.
 *
 * `progressPct` is computed from the done/total ratio of the milestone tasks
 * rather than written by hand, because the goal detail page recomputes it the
 * same way on load — a hand-picked number would visibly disagree with itself.
 */
async function seedGoals(userId: string, clock: Clock) {
  let milestones = 0;
  let tasks = 0;
  const created: Array<{ id: string; title: string }> = [];

  for (const g of D.GOALS) {
    const all = g.milestones.flatMap((m) => m.tasks);
    const done = all.filter((t) => t.done).length;
    const pct = g.status === "COMPLETED"
      ? 100
      : all.length ? Math.round((done / all.length) * 100) : 0;

    const goal = await prisma.goal.create({
      data: {
        userId,
        title: g.title,
        description: g.description,
        category: Category[g.category],
        status: GoalStatus[g.status],
        startDate: clock.at(g.startDay, 9),
        targetDate: clock.at(g.targetDay, 9),
        progressPct: pct,
        planVersion: g.planVersion ?? 1,
        planRationale: g.planRationale ?? null,
        createdAt: clock.at(g.startDay, intBetween(20, 23)),
        updatedAt: clock.at(-intBetween(0, 6), intBetween(9, 22)),
      },
    });
    created.push({ id: goal.id, title: goal.title });

    for (const [i, m] of g.milestones.entries()) {
      const milestone = await prisma.milestone.create({
        data: {
          goalId: goal.id,
          title: m.title,
          description: m.description ?? null,
          status: MilestoneStatus[m.status],
          orderIdx: i,
          targetDate: clock.at(m.targetDay, 9),
          completedAt: m.completedDay != null ? clock.at(m.completedDay, intBetween(18, 22)) : null,
        },
      });
      milestones++;

      // Both halves get spread out rather than stacked on one date. Finished
      // tasks go back across the stretch the milestone was actually worked on;
      // open ones run forward towards its target. Stacking them was the first
      // version of this and it read as a single frantic day either side of now.
      const doneTotal = m.tasks.filter((t) => t.done).length;
      const openTotal = m.tasks.length - doneTotal;
      // An active milestone's target is in the future, so its finished work has
      // to be dated against today instead — hence the -2 clamp.
      const doneEnd = Math.min(-2, m.completedDay ?? m.targetDay);
      const doneStart = Math.max(g.startDay + 1, doneEnd - 45);
      const openEnd = Math.max(3, m.targetDay);
      let doneSeen = 0;
      let openSeen = 0;

      await prisma.task.createMany({
        data: m.tasks.map((t, ti) => {
          const [loHour, hiHour] = GOAL_TASK_HOURS[g.category] ?? [19, 21];
          const hour = intBetween(loHour, hiHour);
          let dueDay: number;
          let completedAt: Date | null = null;

          if (t.done) {
            doneSeen++;
            dueDay = Math.round(doneStart + ((doneEnd - doneStart) * doneSeen) / (doneTotal + 1));
            completedAt = clock.at(dueDay, hour, intBetween(0, 59));
          } else {
            openSeen++;
            dueDay = Math.round(2 + ((openEnd - 2) * openSeen) / (openTotal + 1));
          }

          return taskRow(userId, {
            goalId: goal.id,
            milestoneId: milestone.id,
            title: t.title,
            category: Category[g.category],
            priority: Priority[t.priority ?? "MEDIUM"],
            durationMin: t.durationMin ?? null,
            status: t.done ? TaskStatus.DONE : TaskStatus.TODO,
            dueAt: clock.at(dueDay, hour),
            completedAt,
            source: TaskSource.GOAL_PLAN,
            // The detail page orders a milestone's tasks by createdAt, so the
            // minute carries the plan order — otherwise step 4 shows first.
            createdAt: clock.at(g.startDay, 21, ti),
            updatedAt: completedAt ?? clock.at(-intBetween(1, 20), 21),
          });
        }) as TaskCreate,
      });
      tasks += m.tasks.length;
    }
  }

  return { goals: created, milestones, tasks };
}

// ─────────────────────────────────────────────────────────────
// Notes
// ─────────────────────────────────────────────────────────────

async function seedNotes(userId: string, clock: Clock) {
  const byTitle = new Map<string, string>();

  for (const n of D.NOTES) {
    const note = await prisma.note.create({
      data: {
        userId,
        title: n.title,
        content: n.content,
        excerpt: n.excerpt ?? null,
        tags: n.tags,
        pinned: n.pinned ?? false,
        createdAt: clock.at(n.createdDay, intBetween(9, 23), intBetween(0, 59)),
        updatedAt: clock.at(n.updatedDay, intBetween(9, 23), intBetween(0, 59)),
      },
    });
    byTitle.set(n.title, note.id);
  }

  let links = 0;
  for (const [from, to] of D.NOTE_LINKS) {
    const fromId = byTitle.get(from);
    const toId = byTitle.get(to);
    if (!fromId || !toId) continue;
    await prisma.noteLink.upsert({
      where: { fromId_toId: { fromId, toId } },
      update: {},
      create: { fromId, toId },
    });
    links++;
  }

  return { notes: byTitle.size, links };
}

// ─────────────────────────────────────────────────────────────
// Calendar
// ─────────────────────────────────────────────────────────────

/**
 * A working week that repeats over the visible window, plus the one-offs.
 *
 * These are local events — no `accountId`, no `externalId` — so they need no
 * OAuth, are skipped by the push path (which selects on `accountId`), and
 * cannot collide with a real synced calendar.
 */
async function seedEvents(userId: string, clock: Clock) {
  const from = -21;
  const to = 21;

  /** Nearest weekday to `day`, searching outwards. */
  function toWeekday(day: number): number {
    for (let delta = 0; delta <= 3; delta++) {
      for (const d of delta === 0 ? [day] : [day - delta, day + delta]) {
        const wd = clock.weekday(d);
        if (wd !== 0 && wd !== 6) return d;
      }
    }
    return day;
  }

  // Resolve the one-offs first: a day-eating event (the offsite) has to be
  // known before the recurring meetings on that day are generated.
  const oneOffs = D.ONE_OFF_EVENTS.map((e) => ({
    ...e, day: e.workday ? toWeekday(e.day) : e.day,
  }));
  const workDaysOff = new Set(
    oneOffs.filter((e) => e.blocksWorkday).map((e) => e.day),
  );
  const rows: Array<Record<string, unknown>> = [];

  for (let day = from; day <= to; day++) {
    for (const e of D.WEEKLY_EVENTS) {
      if (clock.weekday(day) !== e.weekday) continue;
      const isWork = Boolean(e.attendees?.length) || e.location === "Meet";
      if (isWork && workDaysOff.has(day)) continue;
      // Not every recurrence happened — meetings get cancelled.
      if (day < 0 && isWork && chance(0.07)) continue;

      const startAt = clock.at(day, e.hour, e.minute ?? 0);
      rows.push({
        title: e.title,
        description: e.description ?? null,
        location: e.location ?? null,
        attendees: e.attendees ?? [],
        rrule: e.rrule,
        startAt,
        endAt: new Date(startAt.getTime() + e.durationMin * 60_000),
        createdAt: clock.at(Math.max(from, day - intBetween(3, 20)), 10),
        updatedAt: clock.at(Math.max(from, day - intBetween(0, 3)), 10),
      });
    }
  }

  for (const e of oneOffs) {
    // An all-day event is a date, not an instant. Anchoring it to UTC midnight
    // of the civil date is what the sync serializer expects (it takes the UTC
    // date part) and what puts it in the right cell of the month grid.
    const startAt = e.allDay ? clock.dateKey(e.day) : clock.at(e.day, e.hour ?? 9, e.minute ?? 0);
    const endAt = e.allDay
      ? clock.dateKey(e.day + (e.days ?? 1))
      : new Date(startAt.getTime() + (e.durationMin ?? 60) * 60_000);
    rows.push({
      title: e.title,
      description: e.description ?? null,
      location: e.location ?? null,
      attendees: e.attendees ?? [],
      allDay: e.allDay ?? false,
      startAt, endAt,
      createdAt: clock.at(e.day - intBetween(4, 25), 11),
      updatedAt: clock.at(Math.min(0, e.day - intBetween(0, 4)), 11),
    });
  }

  await prisma.calendarEvent.createMany({
    data: rows.map((r) => ({ userId, ...r })) as never,
  });
  return rows.length;
}

// ─────────────────────────────────────────────────────────────
// Assistant history
// ─────────────────────────────────────────────────────────────

async function seedConversations(userId: string, clock: Clock) {
  let messages = 0;

  for (const c of D.CONVERSATIONS) {
    let cursor = clock.at(c.day, c.hour, intBetween(0, 40));
    const rows: Array<Record<string, unknown>> = [];

    for (const turn of c.turns) {
      rows.push({ role: MessageRole.USER, content: turn.user, createdAt: cursor });
      cursor = new Date(cursor.getTime() + intBetween(3, 14) * 1000);
      rows.push({
        role: MessageRole.ASSISTANT,
        content: turn.assistant,
        toolPayload: (turn.payload ?? undefined) as never,
        createdAt: cursor,
      });
      cursor = new Date(cursor.getTime() + intBetween(20, 400) * 1000);
    }

    await prisma.conversation.create({
      data: {
        userId,
        title: c.title,
        createdAt: clock.at(c.day, c.hour, 0),
        updatedAt: cursor,
        messages: { create: rows as never },
      },
    });
    messages += rows.length;
  }

  return messages;
}

// ─────────────────────────────────────────────────────────────
// Semantic memory
// ─────────────────────────────────────────────────────────────

/**
 * Embeddings come from the configured Ollama model so `recallSimilar` returns
 * something meaningful. When Ollama isn't running the rows still go in with a
 * null embedding — they read fine, they just don't participate in similarity
 * search until re-embedded.
 */
async function embed(text: string): Promise<number[] | null> {
  const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const model = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
  try {
    const res = await fetch(`${host}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { embedding?: number[] };
    return json.embedding?.length ? json.embedding : null;
  } catch {
    return null;
  }
}

async function seedMemories(userId: string) {
  // One probe decides the mode — no point retrying 42 times against a host
  // that isn't there.
  const probe = await embed(D.MEMORIES[0].content);
  let embedded = 0;

  for (const m of D.MEMORIES) {
    const vec = m === D.MEMORIES[0] ? probe : probe ? await embed(m.content) : null;

    if (vec) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Memory" (id, "userId", kind, "refId", content, embedding, "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, NULL, $3, $4::vector, NOW())`,
        userId, m.kind, m.content, `[${vec.join(",")}]`,
      );
      embedded++;
    } else {
      await prisma.memory.create({
        data: { userId, kind: m.kind, content: m.content },
      });
    }
  }

  return { total: D.MEMORIES.length, embedded };
}

// ─────────────────────────────────────────────────────────────
// Notifications + briefings
// ─────────────────────────────────────────────────────────────

async function seedNotifications(userId: string, clock: Clock) {
  await prisma.notification.createMany({
    data: D.NOTIFICATIONS.map((n) => ({
      userId,
      type: NotificationType[n.type],
      title: n.title,
      body: n.body ?? null,
      actionUrl: n.actionUrl ?? null,
      readAt: n.read ? clock.at(n.day, Math.min(23, n.hour + intBetween(0, 3)), intBetween(0, 59)) : null,
      createdAt: clock.at(n.day, n.hour, intBetween(0, 59)),
    })) as never,
  });
  return D.NOTIFICATIONS.length;
}

/**
 * A briefing for each day the app was opened. Today's counts are read back
 * from the rows just written, so the card on the dashboard agrees with the
 * list underneath it.
 */
async function seedBriefings(
  userId: string,
  clock: Clock,
  goals: Array<{ title: string }>,
  today: { overdue: number; upcoming: number },
) {
  const focus = goals.slice(0, 2).map((g) => g.title);

  for (const daysAgo of D.BRIEFING_DAYS) {
    const overdue = daysAgo === 0 ? today.overdue : intBetween(0, 3);
    const upcoming = daysAgo === 0 ? today.upcoming : intBetween(3, 11);
    const summary = D.BRIEFING_LINES[daysAgo] ?? fallbackSummary(overdue, upcoming);

    await prisma.dailyBriefing.upsert({
      where: { userId_forDate: { userId, forDate: clock.dateKey(-daysAgo) } },
      update: { summary, focusAreas: focus, overdueCount: overdue, upcomingCount: upcoming },
      create: {
        userId,
        forDate: clock.dateKey(-daysAgo),
        summary,
        focusAreas: focus,
        overdueCount: overdue,
        upcomingCount: upcoming,
        createdAt: clock.at(-daysAgo, 7, intBetween(0, 40)),
      },
    });
  }

  return D.BRIEFING_DAYS.length;
}

/** Mirrors the deterministic branch of the real briefing route. */
function fallbackSummary(overdue: number, upcoming: number) {
  const bits: string[] = [];
  if (overdue) bits.push(`${overdue} overdue`);
  if (upcoming) bits.push(`${upcoming} coming up`);
  if (!bits.length) return "Nothing scheduled. A genuinely quiet day.";
  return `You have ${bits.join(", ")}. ${overdue ? "Start with what's overdue." : "A manageable day."}`;
}

// ─────────────────────────────────────────────────────────────

async function main() {
  const { user, how } = await resolveUser();
  const tz = resolveZone(user.timezone);
  const clock = makeClock(tz);

  console.log(`→ seeding ${user.name ?? user.email ?? user.id} (${how}), zone ${tz}`);

  await clearPreviousSeed(user.id, clock);

  // Somebody who has been using the app daily for two months is past
  // onboarding; leaving this null puts the onboarding flow in the way.
  if (!user.onboardedAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { onboardedAt: clock.at(-HISTORY_DAYS, 21) },
    });
  }

  const history = await seedHistory(user.id, clock);
  const habits = await seedHabits(user.id, clock);
  const current = await seedCurrentTasks(user.id, clock);
  const goals = await seedGoals(user.id, clock);
  const notes = await seedNotes(user.id, clock);
  const events = await seedEvents(user.id, clock);
  const messages = await seedConversations(user.id, clock);
  const memories = await seedMemories(user.id);
  const notifications = await seedNotifications(user.id, clock);

  // Read today's real numbers back for the briefing card.
  const open = { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS] };
  const [overdueCount, dueTodayCount, eventsToday] = await Promise.all([
    prisma.task.count({
      where: { userId: user.id, status: open, dueAt: { lt: clock.at(0) } },
    }),
    prisma.task.count({
      where: { userId: user.id, status: open, dueAt: { gte: clock.at(0), lt: clock.at(1) } },
    }),
    prisma.calendarEvent.count({
      where: { userId: user.id, startAt: { gte: clock.at(0), lt: clock.at(1) } },
    }),
  ]);

  const briefings = await seedBriefings(user.id, clock, goals.goals, {
    overdue: overdueCount,
    upcoming: dueTodayCount + eventsToday,
  });

  await ensureVectorIndex();

  const totals = {
    tasks: await prisma.task.count({ where: { userId: user.id } }),
    goals: await prisma.goal.count({ where: { userId: user.id } }),
    notes: await prisma.note.count({ where: { userId: user.id } }),
    events: await prisma.calendarEvent.count({ where: { userId: user.id } }),
  };

  console.log(`
✓ Seeded ${user.email ?? user.id}
  user id      ${user.id}

  tasks        ${history} historical · ${habits} habit occurrences · ${current} current · ${goals.tasks} goal-linked
  goals        ${goals.goals.length} with ${goals.milestones} milestones
  notes        ${notes.notes} with ${notes.links} backlinks
  calendar     ${events} local events
  assistant    ${D.CONVERSATIONS.length} conversations · ${messages} messages
  memory       ${memories.total} rows (${memories.embedded} embedded)
  activity     ${notifications} notifications · ${briefings} daily briefings

  today        ${overdueCount} overdue · ${dueTodayCount} due · ${eventsToday} events
  account now holds ${totals.tasks} tasks, ${totals.goals} goals, ${totals.notes} notes, ${totals.events} events
`);

  if (how === "fallback demo user") {
    console.log(
      "  Note: no signed-in account exists yet, so this went to a demo user.\n"
      + "  Sign in through the app, then re-run `npm run db:seed`.\n",
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
