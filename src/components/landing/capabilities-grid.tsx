"use client";
import { motion } from "framer-motion";
import { Sparkles, Mic, Target, Calendar } from "lucide-react";

const CAPS = [
  {
    icon: Sparkles,
    title: "Understands intent",
    body: "One sentence becomes a structured task. Due date, category, priority, recurrence — inferred. The assistant only asks when it truly cannot guess.",
    accent: "col-span-2",
  },
  {
    icon: Mic,
    title: "Voice-first capture",
    body: "Hold to speak in any of nine languages. Whisper transcribes, the model extracts. Review before commit.",
    accent: "",
  },
  {
    icon: Target,
    title: "Goals become plans",
    body: "Describe the goal. Milestones, recurring practice, realistic durations — drafted in seconds.",
    accent: "",
  },
  {
    icon: Calendar,
    title: "Calendar that sees both",
    body: "Sync Google Calendar bidirectionally. Conflicts flagged. Free-busy aware. Reschedule by sentence.",
    accent: "col-span-2",
  },
];

export function CapabilitiesGrid() {
  return (
    <div className="grid md:grid-cols-3 gap-4 md:gap-5">
      {CAPS.map((cap, i) => (
        <motion.article
          key={cap.title}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
          className={`surface bg-card shadow-soft p-7 md:p-8 hover:shadow-lift transition-all duration-500 hover:-translate-y-0.5 ${cap.accent}`}
        >
          <div className="flex items-start justify-between mb-6">
            <cap.icon className="h-5 w-5 text-foreground" strokeWidth={1.5} />
            <span className="text-xs font-mono text-muted-foreground tabular-nums">
              {String(i + 1).padStart(2, "0")}
            </span>
          </div>
          <h3 className="font-display text-2xl italic leading-tight">{cap.title}</h3>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{cap.body}</p>
        </motion.article>
      ))}
    </div>
  );
}
