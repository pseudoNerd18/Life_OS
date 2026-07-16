import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { calendarEventInputZ } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await currentUser();
  const body = await req.json().catch(() => null);
  const parsed = calendarEventInputZ.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Attach to the user's first active synced calendar, if any, so the next
  // sync push creates it on Google too. No account means a purely local event.
  const account = await prisma.calendarAccount.findFirst({
    where: { userId: user.id, isActive: true },
    select: { id: true },
  });

  const e = await prisma.calendarEvent.create({
    data: {
      userId: user.id,
      accountId: account?.id ?? null,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      location: parsed.data.location ?? null,
      startAt: new Date(parsed.data.startAt),
      endAt: new Date(parsed.data.endAt),
      allDay: parsed.data.allDay ?? false,
    },
  });

  return NextResponse.json(e, { status: 201 });
}
