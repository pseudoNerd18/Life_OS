import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { revokeToken } from "@/lib/calendar/google";

export const runtime = "nodejs";

/**
 * Disconnect a calendar.
 *
 * `CalendarEvent` rows are unlinked rather than left to the schema cascade —
 * some may be locally created or edited, not just a cache of the remote
 * calendar, and losing that data on a disconnect would be a destructive
 * surprise. Tasks we pushed are unlinked the same way. Either side's real
 * data stays; only the link to this account goes.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  const { id } = await params;

  const account = await prisma.calendarAccount.findFirst({
    where: { id, userId: user.id },
  });
  if (!account) return new NextResponse("Not found", { status: 404 });

  // Courtesy revoke — never let a network failure block the disconnect.
  if (account.refreshToken) await revokeToken(account.refreshToken);

  await prisma.task.updateMany({
    where: { userId: user.id, calendarAccountId: account.id },
    data: { externalId: null, calendarAccountId: null, syncedAt: null },
  });
  await prisma.calendarEvent.updateMany({
    where: { userId: user.id, accountId: account.id },
    data: { externalId: null, accountId: null, syncedAt: null },
  });
  await prisma.calendarAccount.delete({ where: { id: account.id } });

  return new NextResponse(null, { status: 204 });
}
