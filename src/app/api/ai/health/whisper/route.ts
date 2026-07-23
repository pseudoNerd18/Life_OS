import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { whisperHealth } from "@/lib/voice/whisper";

export const runtime = "nodejs";

export async function GET() {
  await currentUser(); // ensures a user row exists; result unused
  const r = await whisperHealth();
  return NextResponse.json(r);
}
