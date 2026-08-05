import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { phoneZ } from "@/lib/validation";

export const runtime = "nodejs";

const patchZ = z.object({
  name: z.string().max(100).nullable().optional(),
  timezone: z.string().max(64).optional(),
  locale: z.string().max(10).optional(),
  complete: z.boolean().optional(),
  // Explicit null clears the saved number; omitting the key leaves it alone.
  phone: phoneZ.nullable().optional(),
  callReminders: z.boolean().optional(),
});

export async function GET() {
  const user = await currentUser();
  const u = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      email: true, name: true, image: true, timezone: true, locale: true,
      onboardedAt: true, phone: true, callReminders: true,
    },
  });
  return NextResponse.json(u);
}

export async function PATCH(req: Request) {
  const user = await currentUser();
  const body = await req.json().catch(() => null);
  const parsed = patchZ.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const u = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.timezone ? { timezone: parsed.data.timezone } : {}),
      ...(parsed.data.locale ? { locale: parsed.data.locale } : {}),
      ...(parsed.data.complete ? { onboardedAt: new Date() } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
      ...(parsed.data.callReminders !== undefined ? { callReminders: parsed.data.callReminders } : {}),
    },
    select: {
      email: true, name: true, timezone: true, locale: true,
      onboardedAt: true, phone: true, callReminders: true,
    },
  });
  return NextResponse.json(u);
}
