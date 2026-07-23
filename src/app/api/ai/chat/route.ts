import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { routeMessage } from "@/lib/ai/router";
import { chatMessageZ } from "@/lib/validation";
import { rateLimitFor } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await currentUser();

  const rl = await rateLimitFor("chat", user.id);
  if (!rl.success) return new NextResponse("Too many requests", { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = chatMessageZ.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const timezone = user.timezone ?? "Asia/Kolkata";

  // Find or create conversation
  let conversationId = parsed.data.conversationId;
  if (!conversationId) {
    const c = await prisma.conversation.create({
      data: { userId: user.id },
    });
    conversationId = c.id;
  }

  // Persist user message
  await prisma.message.create({
    data: {
      conversationId,
      role: "USER",
      content: parsed.data.message,
    },
  });

  // Route through AI
  const result = await routeMessage({
    userId: user.id,
    timezone,
    message: parsed.data.message,
  });

  // Persist assistant reply
  await prisma.message.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      content: result.reply,
      toolPayload: result.extracted as object,
    },
  });

  return NextResponse.json({ conversationId, ...result });
}

export async function GET(req: Request) {
  const user = await currentUser();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("conversationId");

  if (id) {
    const conv = await prisma.conversation.findFirst({
      where: { id, userId: user.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    return NextResponse.json(conv);
  }

  const conversations = await prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  return NextResponse.json(conversations);
}
