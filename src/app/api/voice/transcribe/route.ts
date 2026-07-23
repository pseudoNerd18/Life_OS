import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { transcribe } from "@/lib/voice/whisper";
import { rateLimitFor } from "@/lib/server/ratelimit";
import { safeTz } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await currentUser(); // ensures the user row exists; no auth gate

  // Accepts up to 25MB and runs Whisper inference — needs a budget.
  const rl = await rateLimitFor(
    req.headers.get("x-transcribe-partial") === "1" ? "transcribePartial" : "transcribe",
    user.id,
  );
  if (!rl.success) {
    return NextResponse.json({ error: "Too many transcription requests" }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "expected a multipart/form-data body with an `audio` field" },
      { status: 400 },
    );
  }
  const audio = formData.get("audio") as Blob | null;
  const language = (formData.get("language") as string | null) ?? undefined;
  // Hands-free mode re-transcribes the growing utterance every second or so to
  // show live text. Those calls are frequent, disposable, and get their own
  // budget — the default one is sized for deliberate, one-off dictation.
  const partial = formData.get("partial") === "1";

  if (!audio) return NextResponse.json({ error: "audio is required" }, { status: 400 });
  if (audio.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "audio too large" }, { status: 413 });
  }

  // Anchor decoding to the user's wall clock. Whisper can't resolve "tomorrow"
  // — the extractor does that — but naming today keeps spoken dates and
  // weekdays from being decoded as unrelated words.
  const tz = safeTz(user.timezone);
  const prompt = `Today is ${new Date().toLocaleString("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} (${tz}).`;

  try {
    const text = await transcribe({
      audio,
      language: language || undefined,
      prompt,
      partial,
    });
    return NextResponse.json({ text });
  } catch (e) {
    console.error("Whisper error", e);
    return NextResponse.json(
      { error: (e as Error).message ?? "transcription failed" },
      { status: 502 },
    );
  }
}
