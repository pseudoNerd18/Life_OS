import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { noteInputZ } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentUser();
  const notes = await prisma.note.findMany({
    where: { userId: user.id },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });
  return NextResponse.json(notes);
}

export async function POST(req: Request) {
  const user = await currentUser();
  const body = await req.json().catch(() => null);
  const parsed = noteInputZ.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const n = await prisma.note.create({
    data: {
      userId: user.id,
      title: parsed.data.title,
      content: parsed.data.content,
      tags: parsed.data.tags ?? [],
    },
  });
  return NextResponse.json(n, { status: 201 });
}
