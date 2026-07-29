"use client";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useDictation, type DictationPhase } from "@/lib/voice/use-dictation";
import { cn } from "@/lib/utils";

/**
 * Hands-free voice control — one toggle, no press-to-talk.
 *
 * There is exactly one button, and it only ever means "voice mode on/off". A
 * live mic can't be implicit, so entering the mode stays a deliberate act;
 * everything after that — when an utterance starts, when it ends, when to
 * submit — is the detector's job, not yours.
 */
export function HandsFree({
  onUtterance,
  onStopPhrase,
  onInterim,
  onError,
  language,
  onLanguageChange,
  languages,
  disabled,
  liveText,
}: {
  onUtterance: (text: string) => void;
  onStopPhrase?: () => void;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
  language: string;
  onLanguageChange: (l: string) => void;
  languages: Array<{ value: string; label: string }>;
  disabled?: boolean;
  liveText?: boolean;
}) {
  const { phase, level, active, toggle } = useDictation({
    onUtterance, onStopPhrase, onInterim, onError, language, liveText,
  });

  return (
    <div className="flex items-center gap-2 shrink-0">
      {/* Language is a decode hint for Whisper, so it has to be set before you
          speak — it stays visible rather than hiding behind the mic state. */}
      <select
        value={language}
        onChange={(e) => onLanguageChange(e.target.value)}
        className="text-xs bg-secondary text-foreground rounded-md px-2 py-1 border border-border focus:outline-none focus:ring-1 focus:ring-ring"
        aria-label="Dictation language"
      >
        {languages.map((l) => (
          <option key={l.value} value={l.value}>{l.label}</option>
        ))}
      </select>

      {active && <StatusPill phase={phase} level={level} />}

      <Button
        onClick={toggle}
        size="sm"
        variant={active ? "default" : "outline"}
        disabled={disabled}
        aria-pressed={active}
        aria-label={active ? "Turn off voice mode" : "Turn on voice mode"}
        className="relative"
      >
        {phase === "starting" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : active ? (
          <MicOff className="h-3.5 w-3.5" />
        ) : (
          <Mic className="h-3.5 w-3.5" />
        )}
        {active ? "Stop voice" : "Voice"}
      </Button>
    </div>
  );
}

/** What the detector currently thinks is happening, plus a live level ring. */
function StatusPill({ phase, level }: { phase: DictationPhase; level: number }) {
  const label =
    phase === "starting" ? "Starting…"
      : phase === "listening" ? "Listening"
        : phase === "hearing" ? "Hearing you"
          : phase === "finishing" ? "Got it…"
            : "";

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground pr-1">
      <span className="relative inline-flex h-2.5 w-2.5 items-center justify-center">
        {/* Scales with actual mic input, so silence looks like silence. */}
        <motion.span
          className={cn(
            "absolute inset-0 rounded-full",
            phase === "hearing"
              ? "bg-[hsl(var(--priority-high))]"
              : "bg-[hsl(var(--priority-med))]",
          )}
          animate={{ scale: 1 + Math.min(level, 1) * 1.8, opacity: 0.35 }}
          transition={{ duration: 0.08, ease: "linear" }}
        />
        <span
          className={cn(
            "relative inline-flex h-1.5 w-1.5 rounded-full",
            phase === "hearing"
              ? "bg-[hsl(var(--priority-high))]"
              : "bg-[hsl(var(--priority-med))]",
          )}
        />
      </span>
      <span className="tabular-nums">{label}</span>
    </div>
  );
}

export const DICTATION_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी" },
  { value: "mr", label: "मराठी" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "", label: "Auto" },
];
