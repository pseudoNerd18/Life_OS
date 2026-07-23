import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { ollamaHealth } from "@/lib/ai/ollama";

export const runtime = "nodejs";

export async function GET() {
  await currentUser(); // ensures a user row exists; result unused
  const r = await ollamaHealth();
  return NextResponse.json(r);
}
