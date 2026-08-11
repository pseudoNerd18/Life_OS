"use client";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Mic, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMounted } from "@/components/util/client-only";

interface Turn {
  user: string;
  card: { title: string; meta: string; tag: string };
  reply: string;
}

const SCRIPT: Turn[] = [
  {
    user: "Remind me to go to the gym tomorrow evening",
    card: { title: "Go to the gym", meta: "Tomorrow · 6:00 PM · 60 min", tag: "Health" },
    reply: "Added — tomorrow 6:00 PM. I scheduled an hour by default.",
  },
  {
    user: "Help me prepare for GATE in 4 months",
    card: { title: "GATE — 4-month plan", meta: "5 milestones · daily DSA practice", tag: "Goal" },
    reply: "Goal created. I drafted five milestones with daily practice blocks.",
  },
  {
    user: "Take vitamin B12 every 3 days",
    card: { title: "Vitamin B12", meta: "Every 3 days · ongoing", tag: "Health · recurring" },
    reply: "Recurring reminder set. I'll surface it on your dashboard.",
  },
];

/* ───────────────────────── state machine ─────────────────────────
   States: idle → playing → done → (auto) → playing (loop)
   `step` = how many turns are currently visible (0..SCRIPT.length).

   Critical design rule: NOTHING except the machine itself sets `step`.
   Viewport visibility only toggles a `paused` flag — it never resets
   `step`. That's what makes hover/scroll jitter harmless.
─────────────────────────────────────────────────────────────────── */

type Phase = "idle" | "playing" | "done";
interface State { phase: Phase; step: number; }
type Action =
  | { type: "START" }
  | { type: "ADVANCE" }
  | { type: "COMPLETE" }
  | { type: "RESTART" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "START":
      if (state.phase === "playing") return state;
      return { phase: "playing", step: 0 };
    case "ADVANCE": {
      if (state.phase !== "playing") return state;
      const next = Math.min(state.step + 1, SCRIPT.length);
      return { phase: "playing", step: next };
    }
    case "COMPLETE":
      return { phase: "done", step: SCRIPT.length };
    case "RESTART":
      return { phase: "playing", step: 0 };
    default:
      return state;
  }
}

export function LiveDemo() {
  const mounted = useMounted();
  const ref = useRef<HTMLDivElement>(null);
  const [state, dispatch] = useReducer(reducer, { phase: "idle", step: 0 });

  const pausedRef = useRef(false);
  const runningRef = useRef(false);

  const runLoop = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    const waitWhilePaused = async () => {
      while (pausedRef.current) await sleep(120);
    };

    try {
      // Deliberate infinite loop: the demo dialogue restarts forever until the
      // component unmounts and the abort flag breaks out.
      while (true) {
        dispatch({ type: "RESTART" });
        for (let i = 0; i < SCRIPT.length; i++) {
          await sleep(i === 0 ? 650 : 2300);
          await waitWhilePaused();
          if (!runningRef.current) return;
          dispatch({ type: "ADVANCE" });
        }
        dispatch({ type: "COMPLETE" });
        await sleep(5200);
        await waitWhilePaused();
        if (!runningRef.current) return;
      }
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.isIntersecting && entry.intersectionRatio > 0.25;
        pausedRef.current = !visible;
        if (visible && !runningRef.current) {
          dispatch({ type: "START" });
          void runLoop();
        }
      },
      { threshold: [0, 0.25, 0.5] },
    );
    obs.observe(el);

    return () => {
      obs.disconnect();
      runningRef.current = false;
    };
  }, [mounted, runLoop]);

  const replay = () => {
    if (!runningRef.current) {
      dispatch({ type: "START" });
      void runLoop();
    } else {
      dispatch({ type: "RESTART" });
    }
  };

  const visibleTurns = SCRIPT.slice(0, state.step);

  return (
    <div ref={ref} className="relative">
      <div aria-hidden className="absolute -inset-x-12 -inset-y-8 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--foreground)/0.04),transparent_70%)]" />
      </div>

      <div className="relative surface shadow-lift p-5 md:p-7 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70" />
            Live conversation
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={replay}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Replay demo"
            >
              <Play className="h-3 w-3" /> Replay
            </button>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Mic className="h-3 w-3" /> Voice ready
            </div>
          </div>
        </div>

        {/* Fixed min-height so the card never collapses to zero — the root
            cause of the "blank on hover" report. Content fades, frame stays. */}
        <div className="space-y-5 min-h-[420px]">
          {visibleTurns.length === 0 && (
            <div className="h-[420px] flex items-center justify-center">
              <div className="text-center">
                <div className="h-9 w-9 rounded-full bg-secondary mx-auto flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Watch the assistant work…
                </p>
              </div>
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {visibleTurns.map((turn, i) => (
              <Exchange key={`${state.phase}-${i}-${turn.user}`} turn={turn} />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Exchange({ turn }: { turn: Turn }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-3"
    >
      <div className="flex justify-end">
        <div className="bg-foreground text-background rounded-2xl rounded-br-sm px-4 py-2.5 text-sm max-w-[80%]">
          {turn.user}
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4 }}
        className="flex items-start gap-2.5"
      >
        <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0">
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
        </div>
        <div className="flex-1 space-y-2">
          <TaskCard card={turn.card} />
          <p className="text-sm text-muted-foreground leading-relaxed pl-1">{turn.reply}</p>
        </div>
      </motion.div>
    </motion.div>
  );
}

function TaskCard({ card }: { card: Turn["card"] }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.6, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="surface bg-card p-3 flex items-start gap-3"
    >
      <div className="h-4 w-4 rounded border border-border mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-tight">{card.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{card.meta}</p>
      </div>
      <span className={cn(
        "text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full",
        "bg-secondary text-secondary-foreground shrink-0",
      )}>
        {card.tag}
      </span>
    </motion.div>
  );
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
