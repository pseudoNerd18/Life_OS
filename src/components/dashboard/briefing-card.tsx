"use client";
import { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";

interface Briefing {
  summary: string;
  focusAreas: string[];
  overdueCount: number;
  upcomingCount: number;
}

/**
 * Morning briefing card.
 *
 * Fix: the original fetched in a `useEffect` with no cleanup. Navigating away
 * mid-fetch caused `setState` on an unmounted component (React warning + a
 * dangling request). Now the request is aborted on unmount and an `alive`
 * flag guards every state write.
 */
export function BriefingCard() {
  const [b, setB] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/ai/briefing", { signal: controller.signal });
        if (!res.ok) throw new Error(`briefing ${res.status}`);
        const data = (await res.json()) as Briefing;
        if (alive) setB(data);
      } catch (e) {
        // AbortError is expected on unmount — don't treat it as a failure.
        if (alive && (e as Error).name !== "AbortError") setErr(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  if (loading) {
    return (
      <div className="surface p-6 shadow-soft flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <p className="text-sm">Drafting your morning briefing…</p>
      </div>
    );
  }
  if (err || !b) return null;

  return (
    <div className="surface p-6 shadow-soft">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-3 w-3" /> Morning briefing
      </div>
      <p className="mt-3 font-display text-xl italic leading-snug">{b.summary}</p>
      {b.focusAreas.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {b.focusAreas.map((f) => (
            <span key={f} className="text-xs px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground">
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
