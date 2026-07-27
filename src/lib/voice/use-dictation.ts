"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { UtteranceDetector, isUsableTranscript, isStopPhrase } from "./utterance";

/**
 * Hands-free dictation, ChatGPT-voice style.
 *
 * You turn it on once. It then listens continuously: detects when you start
 * speaking, shows the words as they're recognised, notices when you've stopped,
 * hands the finished sentence to the caller, and goes straight back to
 * listening. No press-to-talk.
 *
 * ── Why it works the way it does ─────────────────────────────────────────────
 *
 * Whisper is a batch transcriber, not a streaming one, and the browser's
 * SpeechRecognition API is unusable here (Brave ships it non-functional — it
 * throws `network` because the Google backend key is stripped). So "live text"
 * is built by re-transcribing the utterance-so-far every `partialEveryMs`.
 *
 * Re-transcribing from the *start of the utterance* each time, rather than
 * stitching independent chunks, is deliberate on two counts:
 *   1. A MediaRecorder only puts container headers in its first chunk, so
 *      `[chunk3..chunk5]` is undecodable while `[chunk0..chunkN]` is fine.
 *   2. Whisper needs surrounding context; independently-decoded slices produce
 *      garbage at every boundary.
 *
 * That means one MediaRecorder *per utterance*, started on speech onset.
 *
 * Cost is bounded by keeping exactly one partial request in flight: if a pass
 * is still running when the next tick fires, the tick is skipped. On a CPU
 * Whisper each pass is ~1.8s, so text arrives in ~2s bursts rather than word by
 * word. Set WHISPER_FAST_MODEL to a smaller model to tighten that up.
 */

export type DictationPhase =
  | "off"
  | "starting"
  /** Mic open, waiting for you to say something. */
  | "listening"
  /** You're mid-sentence; partials are streaming in. */
  | "hearing"
  /** You stopped; the final pass is running. */
  | "finishing";

interface Options {
  /** Fires once per finished utterance, with the final transcript. */
  onUtterance: (text: string) => void;
  /** Fires instead of onUtterance when the user says a sign-off phrase. */
  onStopPhrase?: () => void;
  /** Live, not-yet-final text for the current utterance. */
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
  language?: string;
  partialEveryMs?: number;
  /**
   * Stream interim transcripts while the sentence is still being spoken.
   *
   * Off unless a fast Whisper model is configured. On the default `small` model
   * a CPU pass takes 2–7s — longer than the sentence itself — so partials would
   * arrive after you'd already stopped talking, flash text that then changes,
   * and steal CPU from the final pass that actually matters. Set
   * WHISPER_FAST_MODEL (e.g. Systran/faster-whisper-tiny.en) to enable.
   */
  liveText?: boolean;
}

interface Session {
  stream: MediaStream | null;
  audioCtx: AudioContext | null;
  analyser: AnalyserNode | null;
  recorder: MediaRecorder | null;
  raf: number | null;
  partialTimer: ReturnType<typeof setInterval> | null;
}

export function useDictation({
  onUtterance,
  onStopPhrase,
  onInterim,
  onError,
  language,
  partialEveryMs = 1100,
  liveText = false,
}: Options) {
  const [phase, setPhase] = useState<DictationPhase>("off");
  const [level, setLevel] = useState(0);

  const sessionRef = useRef<Session>({
    stream: null, audioCtx: null, analyser: null,
    recorder: null, raf: null, partialTimer: null,
  });
  const detectorRef = useRef(new UtteranceDetector());
  const chunksRef = useRef<Blob[]>([]);
  const partialBusyRef = useRef(false);
  const aliveRef = useRef(true);
  /** Set while an utterance's final pass runs, so a partial can't overwrite it. */
  const finalizingRef = useRef(false);
  /** Lets the recorder callback end the session without a circular dependency. */
  const stopRef = useRef<(() => void) | null>(null);

  // Callbacks live in refs so the audio loop never needs re-creating when a
  // parent re-renders with new closures.
  const cb = useRef({ onUtterance, onStopPhrase, onInterim, onError, language });
  useEffect(() => {
    cb.current = { onUtterance, onStopPhrase, onInterim, onError, language };
  }, [onUtterance, onStopPhrase, onInterim, onError, language]);

  const report = useCallback((msg: string) => {
    if (aliveRef.current) cb.current.onError?.(msg);
  }, []);

  /** Idempotent release of everything the session holds. */
  const teardown = useCallback(() => {
    const s = sessionRef.current;
    if (s.raf != null) { cancelAnimationFrame(s.raf); s.raf = null; }
    if (s.partialTimer) { clearInterval(s.partialTimer); s.partialTimer = null; }
    if (s.recorder && s.recorder.state !== "inactive") {
      try { s.recorder.stop(); } catch { /* already stopped */ }
    }
    s.recorder = null;
    if (s.stream) { s.stream.getTracks().forEach((t) => t.stop()); s.stream = null; }
    if (s.audioCtx && s.audioCtx.state !== "closed") void s.audioCtx.close().catch(() => {});
    s.audioCtx = null;
    s.analyser = null;
    detectorRef.current.reset();
    chunksRef.current = [];
    partialBusyRef.current = false;
    finalizingRef.current = false;
  }, []);

  /** Send audio for transcription. Partials are cheap and best-effort. */
  const send = useCallback(async (blob: Blob, partial: boolean): Promise<string | null> => {
    const form = new FormData();
    form.append("audio", blob, "utterance.webm");
    if (cb.current.language) form.append("language", cb.current.language);
    if (partial) form.append("partial", "1");
    try {
      const res = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: form,
        headers: partial ? { "x-transcribe-partial": "1" } : {},
      });
      if (!res.ok) {
        // A partial failing is not worth interrupting the user over; the final
        // pass is the one that has to succeed.
        if (!partial) {
          const body = await res.json().catch(() => null);
          report(body?.error ?? `Transcription failed (${res.status}).`);
        }
        return null;
      }
      const { text } = (await res.json()) as { text: string };
      return text ?? null;
    } catch {
      if (!partial) report("Transcription service unreachable. Is the Whisper container running?");
      return null;
    }
  }, [report]);

  /** Re-transcribe the utterance so far and show it as interim text. */
  const runPartial = useCallback(async () => {
    if (partialBusyRef.current || finalizingRef.current) return;
    const chunks = chunksRef.current;
    if (!chunks.length) return;

    partialBusyRef.current = true;
    const recorder = sessionRef.current.recorder;
    const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
    try {
      const text = await send(blob, true);
      // Discard if the utterance ended while this was in flight — the final
      // pass owns the text from that point on.
      if (!aliveRef.current || finalizingRef.current) return;
      if (text && text.trim()) cb.current.onInterim?.(text.trim());
    } finally {
      partialBusyRef.current = false;
    }
  }, [send]);

  /** Begin capturing a new utterance. */
  const beginUtterance = useCallback(() => {
    const s = sessionRef.current;
    if (!s.stream || s.recorder) return;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(s.stream, { mimeType: pickMime() });
    } catch {
      report("Recording isn't supported in this browser.");
      return;
    }
    s.recorder = recorder;
    chunksRef.current = [];
    finalizingRef.current = false;

    recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };

    recorder.onstop = async () => {
      const chunks = chunksRef.current;
      const mime = recorder.mimeType;
      chunksRef.current = [];
      if (sessionRef.current.recorder === recorder) sessionRef.current.recorder = null;
      if (!chunks.length) {
        finalizingRef.current = false;
        if (aliveRef.current) setPhase("listening");
        return;
      }
      const text = await send(new Blob(chunks, { type: mime }), false);
      finalizingRef.current = false;
      if (!aliveRef.current) return;
      // Back to listening either way — hands-free means never waiting on a tap.
      setPhase("listening");
      if (!text || !isUsableTranscript(text)) {
        cb.current.onInterim?.("");   // clear the interim preview
        return;
      }
      const spoken = text.trim();
      // "That'll be all" ends the session rather than being filed as a task.
      if (isStopPhrase(spoken)) {
        cb.current.onInterim?.("");
        cb.current.onStopPhrase?.();
        stopRef.current?.();
        return;
      }
      cb.current.onUtterance(spoken);
    };

    // 250ms slices: small enough that a partial always has fresh audio, large
    // enough not to spam the accumulator.
    recorder.start(250);
    if (aliveRef.current) setPhase("hearing");

    if (s.partialTimer) clearInterval(s.partialTimer);
    if (liveText) {
      s.partialTimer = setInterval(() => { void runPartial(); }, partialEveryMs);
    }
  }, [report, runPartial, partialEveryMs, send, liveText]);

  /** Close the current utterance and let onstop finalize it. */
  const endUtterance = useCallback(() => {
    const s = sessionRef.current;
    if (s.partialTimer) { clearInterval(s.partialTimer); s.partialTimer = null; }
    finalizingRef.current = true;
    if (aliveRef.current) setPhase("finishing");
    if (s.recorder && s.recorder.state !== "inactive") {
      s.recorder.stop();   // → onstop runs the final pass
    } else {
      finalizingRef.current = false;
      if (aliveRef.current) setPhase("listening");
    }
  }, []);

  const stop = useCallback(() => {
    detectorRef.current.flush(now());
    teardown();
    if (aliveRef.current) {
      setPhase("off");
      setLevel(0);
    }
  }, [teardown]);

  const start = useCallback(async () => {
    if (sessionRef.current.stream) return;
    setPhase("starting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Gate the noise floor at the source so VAD sees speech, not room hum.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      if (aliveRef.current) setPhase("off");
      report(
        (e as Error)?.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in your browser's site settings."
          : "Could not access the microphone.",
      );
      return;
    }
    if (!aliveRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }

    const s = sessionRef.current;
    s.stream = stream;
    detectorRef.current.reset();

    try {
      const audioCtx = new AudioContext();
      s.audioCtx = audioCtx;
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.4;
      src.connect(analyser);
      s.analyser = analyser;

      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (!aliveRef.current || !sessionRef.current.analyser) return;
        analyser.getFloatTimeDomainData(buf);
        // RMS, not peak: peak reacts to every transient, RMS tracks loudness.
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 6));

        const ev = detectorRef.current.push(rms, now());
        if (ev?.type === "start") beginUtterance();
        else if (ev?.type === "end") endUtterance();

        sessionRef.current.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      teardown();
      report("This browser can't analyse microphone input.");
      if (aliveRef.current) setPhase("off");
      return;
    }

    if (aliveRef.current) setPhase("listening");
  }, [beginUtterance, endUtterance, report, teardown]);

  // Published after `stop` exists so recorder callbacks can end the session.
  useEffect(() => { stopRef.current = stop; }, [stop]);

  const toggle = useCallback(() => {
    if (sessionRef.current.stream) stop();
    else void start();
  }, [start, stop]);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; teardown(); };
  }, [teardown]);

  return { phase, level, active: phase !== "off", start, stop, toggle };
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function pickMime() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? "";
}
