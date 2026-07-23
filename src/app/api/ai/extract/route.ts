import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { extractIntent } from "@/lib/ai/extractor";
import { rateLimitFor } from "@/lib/server/ratelimit";
import { z } from "zod";

export const runtime = "nodejs";

const bodyZ = z.object({ text: z.string().min(1).max(4000) });

export async function POST(req: Request) {
  const user = await currentUser();

  const rl = await rateLimitFor("extract", user.id);
  if (!rl.success) return new NextResponse("Too many requests", { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = bodyZ.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const intent = await extractIntent(parsed.data.text, {
    timezone: user.timezone ?? "Asia/Kolkata",
  });

  // NB: this endpoint is preview-only — it does NOT persist. The client commits
  // via /api/tasks after the user reviews and edits.
  return NextResponse.json(intent);
}
