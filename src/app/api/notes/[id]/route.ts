import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { noteInputZ } from "@/lib/validation";
import { z } from "zod";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = noteInputZ.partial().extend({
    pinned: z.boolean().optional(),
  }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const existing = await prisma.note.findFirst({ where: { id, userId: user.id } });
  if (!existing) return new NextResponse("Not found", { status: 404 });

  const updated = await prisma.note.update({
    where: { id },
    data: parsed.data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  const { id } = await params;
  const existing = await prisma.note.findFirst({ where: { id, userId: user.id } });
  if (!existing) return new NextResponse("Not found", { status: 404 });
  await prisma.note.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
