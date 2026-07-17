/**
 * Side-effect / mutation layer.
 *
 * Pure functions that take userId + structured input and write to the DB.
 * Called from both the AI router and the REST API routes.
 */
import { prisma } from "@/lib/db";
import { planGoal } from "@/lib/ai/planner";
import type { ExtractedIntent } from "@/lib/validation";
import { Priority, Category, TaskStatus, TaskSource } from "@prisma/client";

type ExtractedTask = NonNullable<ExtractedIntent["tasks"]>[number];

function normalizePriority(p?: string): Priority {
  switch (p) {
    case "LOW": return Priority.LOW;
    case "HIGH": return Priority.HIGH;
    case "URGENT": return Priority.URGENT;
    default: return Priority.MEDIUM;
  }
}

function normalizeCategory(c?: string): Category {
  const k = (c ?? "OTHER") as keyof typeof Category;
  return Category[k] ?? Category.OTHER;
}

export async function createTasksFromIntent(userId: string, tasks: ExtractedTask[]): Promise<string[]> {
  // One sentence should not become two identical rows. Small models sometimes
  // split "go to the gym tomorrow evening" into duplicate tasks, which then
  // makes "I finished the gym task" genuinely ambiguous.
  const seen = new Set<string>();
  const unique = tasks.filter((t) => {
    const key = t.title.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const created = await prisma.$transaction(
    unique.map((t) =>
      prisma.task.create({
        data: {
          userId,
          title: t.title,
          description: t.description ?? null,
          priority: normalizePriority(t.priority),
          category: normalizeCategory(t.category),
          dueAt: t.dueAt ? new Date(t.dueAt) : null,
          durationMin: t.durationMin ?? null,
          rrule: t.rrule ?? null,
          source: TaskSource.CHAT,
          status: TaskStatus.TODO,
        },
        select: { id: true },
      }),
    ),
  );
  return created.map((r: { id: string }) => r.id);
}

export async function createGoalFromIntent(
  userId: string,
  timezone: string,
  goal: NonNullable<ExtractedIntent["goal"]>,
) {
  // 1. Create goal row
  const g = await prisma.goal.create({
    data: {
      userId,
      title: goal.title,
      description: goal.description ?? null,
      category: normalizeCategory(goal.category),
      targetDate: goal.targetDate ? new Date(goal.targetDate) : null,
    },
  });

  // 2. Plan asynchronously (don't block the chat reply on this)
  //    For simplicity we await — but in prod move this to a job queue.
  planGoal({
    title: goal.title,
    description: goal.description ?? undefined,
    targetDate: goal.targetDate ?? null,
    timezone,
  })
    .then(async (plan) => {
      if (!plan.milestones.length) return;
      await prisma.goal.update({
        where: { id: g.id },
        data: { planRationale: plan.rationale },
      });
      for (let i = 0; i < plan.milestones.length; i++) {
        const m = plan.milestones[i];
        const milestone = await prisma.milestone.create({
          data: {
            goalId: g.id,
            title: m.title,
            description: m.description ?? "",
            orderIdx: i,
            targetDate: m.targetDate ? new Date(m.targetDate) : null,
          },
        });
        if (m.tasks?.length) {
          await prisma.task.createMany({
            data: m.tasks.map((t) => ({
              userId,
              goalId: g.id,
              milestoneId: milestone.id,
              title: t.title,
              description: t.description ?? null,
              category: normalizeCategory(t.category),
              priority: normalizePriority(t.priority),
              durationMin: t.durationMin ?? null,
              rrule: t.rrule ?? null,
              source: TaskSource.GOAL_PLAN,
              status: TaskStatus.TODO,
            })),
          });
        }
      }
    })
    .catch((e) => console.error("Goal planning failed", e));

  return { goalId: g.id };
}

export async function createNoteFromIntent(
  userId: string,
  note: NonNullable<ExtractedIntent["note"]>,
) {
  const n = await prisma.note.create({
    data: {
      userId,
      title: note.title,
      content: note.content,
      tags: note.tags ?? [],
    },
  });
  return n.id;
}

// ─────────────────────────────────────────────────────────────
// Acting on things that already exist.
//
// Voice makes these riskier than creation: Whisper turns "Remind" into "Find"
// and "4 PM" into "4 AM", and in hands-free mode nobody is confirming. So every
// destructive action returns a snapshot the caller can restore from, and the
// reply always names what was hit so a mistake is visible immediately.
// ─────────────────────────────────────────────────────────────

import type { TargetKind } from "@/lib/server/resolve";

/** Everything needed to recreate a deleted row. */
export interface DeletedSnapshot {
  kind: TargetKind;
  title: string;
  data: Record<string, unknown>;
}

type Patch = NonNullable<ExtractedIntent["patch"]>;

/**
 * Apply a text replacement — "it should say X not Y".
 *
 * Case-insensitive, first occurrence only. Returns null when the text isn't
 * there, so the caller can say so instead of reporting a silent no-op.
 */
export function applyReplacement(source: string, from: string, to: string): string | null {
  const i = source.toLowerCase().indexOf(from.toLowerCase());
  if (i < 0) return null;
  return source.slice(0, i) + to + source.slice(i + from.length);
}

export async function updateEntity(
  userId: string,
  kind: TargetKind,
  id: string,
  patch: Patch,
): Promise<{ ok: true; title: string; changed: string[] } | { ok: false; reason: string }> {
  const changed: string[] = [];

  if (kind === "note") {
    const note = await prisma.note.findFirst({ where: { id, userId } });
    if (!note) return { ok: false, reason: "not-found" };

    const data: Record<string, unknown> = {};
    if (patch.replace) {
      // Try the body first, then the title — "it should say X not Y" usually
      // means the content, but a short note may only have a title.
      const inBody = applyReplacement(note.content, patch.replace.from, patch.replace.to);
      if (inBody !== null) { data.content = inBody; changed.push("content"); }
      else {
        const inTitle = applyReplacement(note.title, patch.replace.from, patch.replace.to);
        if (inTitle !== null) { data.title = inTitle; changed.push("title"); }
        else return { ok: false, reason: "text-not-found" };
      }
    }
    if (patch.content) { data.content = patch.content; changed.push("content"); }
    if (patch.title) { data.title = patch.title; changed.push("title"); }
    if (!changed.length) return { ok: false, reason: "nothing-to-change" };

    const updated = await prisma.note.update({ where: { id }, data, select: { title: true } });
    return { ok: true, title: updated.title, changed };
  }

  if (kind === "goal") {
    const goal = await prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) return { ok: false, reason: "not-found" };
    const data: Record<string, unknown> = {};
    if (patch.title) { data.title = patch.title; changed.push("title"); }
    if (patch.description) { data.description = patch.description; changed.push("description"); }
    if (patch.category) { data.category = normalizeCategory(patch.category); changed.push("category"); }
    if (patch.dueAt) { data.targetDate = new Date(patch.dueAt); changed.push("target date"); }
    if (!changed.length) return { ok: false, reason: "nothing-to-change" };
    const updated = await prisma.goal.update({ where: { id }, data, select: { title: true } });
    return { ok: true, title: updated.title, changed };
  }

  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) return { ok: false, reason: "not-found" };

  const data: Record<string, unknown> = {};
  if (patch.replace) {
    const inTitle = applyReplacement(task.title, patch.replace.from, patch.replace.to);
    if (inTitle !== null) { data.title = inTitle; changed.push("title"); }
    else return { ok: false, reason: "text-not-found" };
  }
  if (patch.title) { data.title = patch.title; changed.push("title"); }
  if (patch.description) { data.description = patch.description; changed.push("description"); }
  if (patch.dueAt) { data.dueAt = new Date(patch.dueAt); changed.push("due date"); }
  if (patch.priority) { data.priority = normalizePriority(patch.priority); changed.push("priority"); }
  if (patch.category) { data.category = normalizeCategory(patch.category); changed.push("category"); }
  if (patch.durationMin) { data.durationMin = patch.durationMin; changed.push("duration"); }
  if (patch.rrule) { data.rrule = patch.rrule; changed.push("recurrence"); }
  if (patch.status) {
    data.status = patch.status as TaskStatus;
    data.completedAt = patch.status === "DONE" ? new Date() : null;
    changed.push("status");
  }
  if (!changed.length) return { ok: false, reason: "nothing-to-change" };

  const updated = await prisma.task.update({ where: { id }, data, select: { title: true } });
  return { ok: true, title: updated.title, changed };
}

export async function completeTask(
  userId: string,
  id: string,
): Promise<{ ok: true; title: string } | { ok: false; reason: string }> {
  const task = await prisma.task.findFirst({ where: { id, userId }, select: { id: true } });
  if (!task) return { ok: false, reason: "not-found" };
  const updated = await prisma.task.update({
    where: { id },
    data: { status: TaskStatus.DONE, completedAt: new Date() },
    select: { title: true },
  });
  return { ok: true, title: updated.title };
}

export async function deleteEntity(
  userId: string,
  kind: TargetKind,
  id: string,
): Promise<{ ok: true; snapshot: DeletedSnapshot } | { ok: false; reason: string }> {
  if (kind === "note") {
    const note = await prisma.note.findFirst({ where: { id, userId } });
    if (!note) return { ok: false, reason: "not-found" };
    await prisma.note.delete({ where: { id } });
    return {
      ok: true,
      snapshot: {
        kind, title: note.title,
        data: { title: note.title, content: note.content, tags: note.tags, pinned: note.pinned },
      },
    };
  }

  if (kind === "goal") {
    const goal = await prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) return { ok: false, reason: "not-found" };
    await prisma.goal.delete({ where: { id } });
    return {
      ok: true,
      snapshot: {
        kind, title: goal.title,
        data: {
          title: goal.title, description: goal.description, category: goal.category,
          targetDate: goal.targetDate, startDate: goal.startDate,
        },
      },
    };
  }

  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) return { ok: false, reason: "not-found" };
  await prisma.task.delete({ where: { id } });
  return {
    ok: true,
    snapshot: {
      kind, title: task.title,
      data: {
        title: task.title, description: task.description, priority: task.priority,
        category: task.category, dueAt: task.dueAt, durationMin: task.durationMin,
        rrule: task.rrule, status: task.status,
      },
    },
  };
}

/** Recreate something a delete removed. The id changes; nothing else does. */
export async function restoreEntity(
  userId: string,
  snapshot: DeletedSnapshot,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const d = snapshot.data as Record<string, never>;
  try {
    if (snapshot.kind === "note") {
      const n = await prisma.note.create({
        data: {
          userId,
          title: String(d.title ?? "Untitled"),
          content: String(d.content ?? ""),
          tags: Array.isArray(d.tags) ? d.tags : [],
          pinned: Boolean(d.pinned),
        },
        select: { id: true },
      });
      return { ok: true, id: n.id };
    }
    if (snapshot.kind === "goal") {
      const g = await prisma.goal.create({
        data: {
          userId,
          title: String(d.title ?? "Untitled"),
          description: d.description ? String(d.description) : null,
          category: normalizeCategory(d.category),
          targetDate: d.targetDate ? new Date(d.targetDate) : null,
          startDate: d.startDate ? new Date(d.startDate) : null,
        },
        select: { id: true },
      });
      return { ok: true, id: g.id };
    }
    const t = await prisma.task.create({
      data: {
        userId,
        title: String(d.title ?? "Untitled"),
        description: d.description ? String(d.description) : null,
        priority: normalizePriority(d.priority),
        category: normalizeCategory(d.category),
        dueAt: d.dueAt ? new Date(d.dueAt) : null,
        durationMin: d.durationMin ? Number(d.durationMin) : null,
        rrule: d.rrule ? String(d.rrule) : null,
        status: (d.status as TaskStatus) ?? TaskStatus.TODO,
        source: TaskSource.CHAT,
      },
      select: { id: true },
    });
    return { ok: true, id: t.id };
  } catch (e) {
    console.error("[restore] failed:", (e as Error).message);
    return { ok: false, reason: "restore-failed" };
  }
}
