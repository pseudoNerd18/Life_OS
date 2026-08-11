"use client";
import { motion } from "framer-motion";
import { Mic, FileText, Cpu, Database, MessageSquare } from "lucide-react";

const STAGES = [
  { icon: Mic,          label: "You speak",      sub: "Or you type." },
  { icon: FileText,     label: "Transcribe",     sub: "Local Whisper." },
  { icon: Cpu,          label: "Understand",     sub: "Gemma extracts intent, dates, recurrence." },
  { icon: Database,     label: "Structure",      sub: "Tasks, goals, notes — typed and stored." },
  { icon: MessageSquare,label: "Reply",          sub: "Calm, concise, deterministic." },
];

/**
 * The architecture section. Visually distinct from everything else — dark
 * canvas, monospaced labels, a real pipeline you can follow with your eyes.
 *
 * The connecting line draws on scroll (clipPath inset), giving a sense that
 * data flows through it.
 */
export function SystemDiagram() {
  return (
    <div className="relative">
      <div className="relative grid md:grid-cols-5 gap-3 md:gap-2">
        {STAGES.map((s, i) => (
          <Stage key={s.label} stage={s} index={i} total={STAGES.length} />
        ))}
      </div>

      <p className="mt-12 text-center text-sm text-neutral-400 max-w-xl mx-auto leading-relaxed">
        Every step runs on your machine by default — Postgres, Ollama, Whisper.
        No telemetry, no cloud round-trips for the things that matter.
      </p>
    </div>
  );
}

function Stage({ stage, index, total }: { stage: typeof STAGES[number]; index: number; total: number }) {
  const Icon = stage.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.6 }}
      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex flex-col items-center text-center px-2"
    >
      {/* connector to next stage */}
      {index < total - 1 && (
        <motion.span
          aria-hidden
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: index * 0.08 + 0.3 }}
          style={{ transformOrigin: "left center" }}
          className="hidden md:block absolute top-7 left-[55%] right-[-45%] h-px bg-gradient-to-r from-neutral-700 via-neutral-600 to-neutral-700"
        />
      )}
      <div className="relative h-14 w-14 rounded-full border border-neutral-800 bg-neutral-900 flex items-center justify-center mb-4">
        <Icon className="h-5 w-5 text-neutral-300" strokeWidth={1.5} />
        <span className="absolute inset-0 rounded-full border border-neutral-700 animate-pulse-soft" />
      </div>
      <p className="text-sm text-neutral-100 font-medium tracking-tight">{stage.label}</p>
      <p className="mt-1 text-xs text-neutral-500 font-mono leading-snug">{stage.sub}</p>
    </motion.div>
  );
}
