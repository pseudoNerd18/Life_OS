"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Loader2, Square } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useVoice } from "@/stores/assistant";

/**
 * Voice recorder — hardened against resource leaks.
 *
 * The original bug: a MediaRecorder, an AudioContext, a getUserMedia stream,
 * and a requestAnimationFrame loop were all created in `start()`, but the
 * unmount cleanup only stopped the MediaRecorder. Unmounting mid-recording
 * leaked the AudioContext + stream tracks and left the rAF loop calling
 * `setLevel` on an unmounted component (React warning + leak).
 *
 * Fix:
 *  - Every teardownable resource is held in a single `resourcesRef`.
 *  - `teardown()` is the one place that releases everything, and it's
 *    idempotent.
 *  - An `aliveRef` flag guards every post-await `setState` so nothing updates
 *    after unmount.
 *  - The unmount effect calls `teardown()`.
 */

interface Resources {
  stream: MediaStream | null;
  audioCtx: AudioContext | null;
  recorder: MediaRecorder | null;
  raf: number | null;
}

interface VoiceRecorderProps {
  onTranscript: (text: string) => void;
  /**
   * Where user-facing failures go. Defaults to a toast, which is right for the
   * assistant page and onboarding. Quick Capture passes its own handler so
   * dictation errors land in the inline activity log with everything else.
   */
  onError?: (message: string) => void;
}

export function VoiceRecorder({ onTranscript, onError }: VoiceRecorderProps) {
  const {
    recording, transcribing, language,
    setRecording, setTranscribing, setTranscript, setLanguage,
  } = useVoice();

  const [level, setLevel] = useState(0);

  const resourcesRef = useRef<Resources>({
    stream: null, audioCtx: null, recorder: null, raf: null,
  });
  const chunksRef = useRef<Blob[]>([]);
  const aliveRef = useRef(true);

  /** Idempotent release of every audio resource. Safe to call multiple times. */
  const teardown = useCallback(() => {
    const r = resourcesRef.current;
    if (r.raf != null) {
      cancelAnimationFrame(r.raf);
      r.raf = null;
    }
    if (r.recorder && r.recorder.state !== "inactive") {
      try { r.recorder.stop(); } catch { /* already stopped */ }
    }
    r.recorder = null;
    if (r.stream) {
      r.stream.getTracks().forEach((t) => t.stop());
      r.stream = null;
    }
    if (r.audioCtx && r.audioCtx.state !== "closed") {
      // close() returns a promise; we don't await — fire and forget is fine.
      void r.audioCtx.close().catch(() => {});
    }
    r.audioCtx = null;
  }, []);

  const safeSet = useCallback(<T,>(fn: (v: T) => void, v: T) => {
    if (aliveRef.current) fn(v);
  }, []);

  /** Single exit for anything the user needs to be told about. */
  const report = useCallback((message: string) => {
    if (!aliveRef.current) return;
    if (onError) onError(message);
    else toast.error(message);
  }, [onError]);

  async function upload(blob: Blob) {
    safeSet(setTranscribing, true);
    try {
      const form = new FormData();
      form.append("audio", blob, "audio.webm");
      if (language) form.append("language", language);
      const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const { text } = (await res.json()) as { text: string };
      if (!aliveRef.current) return; // component gone — drop the result silently
      setTranscript(text);
      onTranscript(text);
    } catch (e) {
      report(describeTranscribeError(e));
      console.error("[voice] transcription error:", e);
    } finally {
      safeSet(setTranscribing, false);
    }
  }

  async function start() {
    if (recording) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      report(
        (e as Error)?.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in your browser's site settings."
          : "Could not access the microphone.",
      );
      console.error("[voice] getUserMedia failed:", e);
      return;
    }
    // If the component unmounted while we awaited permission, bail and release.
    if (!aliveRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const r = resourcesRef.current;
    r.stream = stream;

    // Audio-level meter for the pulse animation.
    try {
      const audioCtx = new AudioContext();
      r.audioCtx = audioCtx;
      const srcNode = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      srcNode.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!aliveRef.current) return; // stop touching state after unmount
        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        setLevel(Math.min(1, avg / 128));
        r.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      // Meter is non-essential — recording can proceed without it.
      console.warn("[voice] level meter unavailable:", e);
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: pickMime() });
    } catch (e) {
      report("Recording isn't supported in this browser.");
      console.error("[voice] MediaRecorder ctor failed:", e);
      teardown();
      return;
    }
    r.recorder = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      const mime = recorder.mimeType;
      const chunks = chunksRef.current;
      // Release audio resources immediately; we have the chunks.
      teardown();
      if (aliveRef.current) setLevel(0);
      if (chunks.length) {
        const blob = new Blob(chunks, { type: mime });
        await upload(blob);
      }
    };

    recorder.start();
    safeSet(setRecording, true);
  }

  function stop() {
    const r = resourcesRef.current;
    if (r.recorder && r.recorder.state !== "inactive") {
      r.recorder.stop(); // triggers onstop → teardown + upload
    } else {
      teardown();
    }
    safeSet(setRecording, false);
  }

  // Single unmount cleanup — releases everything regardless of state.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      teardown();
    };
  }, [teardown]);

  return (
    <div className="flex items-center gap-3">
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        className="text-xs bg-secondary text-foreground rounded-md px-2 py-1 border border-border focus:outline-none focus:ring-1 focus:ring-ring"
        aria-label="Language"
      >
        <option value="en">English</option>
        <option value="hi">हिन्दी</option>
        <option value="mr">मराठी</option>
        <option value="es">Español</option>
        <option value="fr">Français</option>
        <option value="de">Deutsch</option>
        <option value="">Auto</option>
      </select>

      <AnimatePresence mode="wait" initial={false}>
        {recording ? (
          <motion.div
            key="recording"
            className="flex items-center gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <span className="relative inline-flex h-2 w-2">
              <span
                className="absolute inset-0 rounded-full bg-[hsl(var(--priority-high))]"
                style={{
                  transform: `scale(${1 + level * 1.5})`,
                  transition: "transform 60ms linear",
                }}
              />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[hsl(var(--priority-high))]" />
            </span>
            <Button onClick={stop} size="sm" variant="outline">
              <Square className="h-3 w-3 fill-current" />
              Stop
            </Button>
          </motion.div>
        ) : transcribing ? (
          <motion.div key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Button size="sm" variant="outline" disabled>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Transcribing
            </Button>
          </motion.div>
        ) : (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Button onClick={start} size="sm" variant="outline">
              <Mic className="h-3.5 w-3.5" />
              Record
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Turn a transcription failure into something actionable. The route returns a
 * JSON body with an `error` field; a dead Whisper shows up as a 502.
 */
function describeTranscribeError(e: unknown): string {
  const raw = (e as Error)?.message ?? "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error) return String(parsed.error);
  } catch {
    /* not JSON — fall through */
  }
  if (/fetch failed|ECONNREFUSED/i.test(raw)) {
    return "Transcription service unreachable. Is the Whisper container running?";
  }
  return raw.trim() ? `Transcription failed: ${raw.slice(0, 160)}` : "Transcription failed.";
}

function pickMime() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? "";
}
