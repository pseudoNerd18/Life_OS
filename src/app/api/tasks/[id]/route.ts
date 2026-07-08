import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { taskInputZ } from "@/lib/validation";
import { withdrawTaskEvent } from "@/lib/calendar/sync";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  const { id } = await params;
  const body = await req.json().catch(() => null);

  // partial updates allowed
  const parsed = taskInputZ.partial().extend({
    status: taskInputZ.shape.status,
    completedAt: taskInputZ.shape.dueAt,
  }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const existing = await prisma.task.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return new NextResponse("Not found", { status: 404 });

  // If status flips to DONE, stamp completedAt
  const willComplete =
    parsed.data.status === "DONE" && existing.status !== "DONE";

  const updated = await prisma.task.update({
    where: { id },
    data: {
      ...parsed.data,
      dueAt: parsed.data.dueAt === undefined ? undefined : (parsed.data.dueAt ? new Date(parsed.data.dueAt) : null),
      startAt: parsed.data.startAt === undefined ? undefined : (parsed.data.startAt ? new Date(parsed.data.startAt) : null),
      remindAt: parsed.data.remindAt === undefined ? undefined : (parsed.data.remindAt ? new Date(parsed.data.remindAt) : null),
      completedAt: willComplete ? new Date() : undefined,
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  const { id } = await params;

  const existing = await prisma.task.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return new NextResponse("Not found", { status: 404 });

  // Take the event off Google too, or a deleted task leaves an orphan on the
  // real calendar that no later sync would ever clean up. Best-effort: the
  // local delete must still happen if Google is unreachable.
  await withdrawTaskEvent(existing);

  await prisma.task.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
