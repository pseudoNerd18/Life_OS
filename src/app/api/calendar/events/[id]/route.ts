import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { calendarEventInputZ } from "@/lib/validation";
import { withdrawCalendarEvent } from "@/lib/calendar/sync";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  const { id } = await params;
  const body = await req.json().catch(() => null);

  const parsed = calendarEventInputZ.partial().safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const existing = await prisma.calendarEvent.findFirst({ where: { id, userId: user.id } });
  if (!existing) return new NextResponse("Not found", { status: 404 });

  const updated = await prisma.calendarEvent.update({
    where: { id },
    data: {
      ...parsed.data,
      startAt: parsed.data.startAt === undefined ? undefined : new Date(parsed.data.startAt),
      endAt: parsed.data.endAt === undefined ? undefined : new Date(parsed.data.endAt),
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

  const existing = await prisma.calendarEvent.findFirst({ where: { id, userId: user.id } });
  if (!existing) return new NextResponse("Not found", { status: 404 });

  // Take the event off Google too, or a deleted event leaves an orphan on the
  // real calendar. Best-effort: the local delete must still happen if Google
  // is unreachable.
  await withdrawCalendarEvent(existing);

  await prisma.calendarEvent.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
