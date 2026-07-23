/**
 * Whisper transcription gateway.
 *
 * Two modes (controlled by WHISPER_MODE):
 *  - "local":  POST to a self-hosted faster-whisper-server (OpenAI-compatible).
 *  - "openai": OpenAI Whisper API.
 *
 * Returns plain text. Caller is responsible for piping it into the AI router.
 */

const MODE = (process.env.WHISPER_MODE ?? "local") as "local" | "openai";
const LOCAL_URL = process.env.WHISPER_SERVER_URL ?? "http://localhost:9000";

/**
 * Model used for live interim transcripts in hands-free mode. Accuracy matters
 * less than turnaround there — the final pass re-transcribes with the default
 * model anyway. Point this at a smaller model (e.g.
 * `Systran/faster-whisper-tiny.en`) to make dictation feel instant; if it isn't
 * pulled, the server falls back to its default and partials are merely slower.
 */
const FAST_MODEL = process.env.WHISPER_FAST_MODEL || "";

export interface TranscribeArgs {
  audio: Blob;
  language?: string; // ISO 639-1 (e.g. "en", "hi", "mr"), undefined → auto
  filename?: string;
  /**
   * Whisper's initial prompt. It biases decoding toward this vocabulary and
   * style — useful for anchoring spoken dates ("the twenty-third", "next
   * Tuesday") to a consistent surface form. Whisper sometimes echoes the
   * prompt back at the head of the transcript, so we strip it below.
   */
  prompt?: string;
  /**
   * Interim transcript for a still-in-progress utterance: prefer speed, and let
   * the server drop silent stretches itself.
   */
  partial?: boolean;
}

export async function transcribe({
  audio,
  language,
  filename = "audio.webm",
  prompt,
  partial = false,
}: TranscribeArgs): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  // faster-whisper-server uses the OpenAI shape. "whisper-1" is the alias for
  // whatever the server was started with; a partial may override it.
  form.append("model", partial && FAST_MODEL ? FAST_MODEL : "whisper-1");
  form.append("response_format", "text");
  if (language) form.append("language", language);
  if (prompt) form.append("prompt", prompt);
  if (partial && MODE === "local") {
    // Skip silent stretches so an interim pass spends its time on speech.
    form.append("vad_filter", "true");
  }

  const url =
    MODE === "openai"
      ? "https://api.openai.com/v1/audio/transcriptions"
      : `${LOCAL_URL}/v1/audio/transcriptions`;

  const headers: HeadersInit = {};
  if (MODE === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY required when WHISPER_MODE=openai");
    }
    headers["Authorization"] = `Bearer ${process.env.OPENAI_API_KEY}`;
  }

  const res = await fetch(url, { method: "POST", body: form, headers });
  if (!res.ok) {
    throw new Error(`Whisper failed (${res.status}): ${await res.text()}`);
  }
  return stripEchoedPrompt((await res.text()).trim(), prompt);
}

/**
 * Whisper occasionally transcribes its own initial prompt. Drop it when the
 * transcript opens with it verbatim — anything else is left untouched, since
 * the user may legitimately have said something similar.
 */
function stripEchoedPrompt(text: string, prompt?: string): string {
  if (!prompt) return text;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const [t, p] = [norm(text), norm(prompt)];
  if (!t.startsWith(p)) return text;
  return text.slice(prompt.length).replace(/^[\s.,;:—-]+/, "").trim();
}

export async function whisperHealth() {
  try {
    if (MODE === "openai") {
      return { ok: !!process.env.OPENAI_API_KEY, mode: MODE };
    }
    const res = await fetch(`${LOCAL_URL}/v1/models`, { method: "GET" });
    return { ok: res.ok, mode: MODE, status: res.status };
  } catch (e) {
    return { ok: false, mode: MODE, error: (e as Error).message };
  }
}
