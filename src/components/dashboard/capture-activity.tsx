"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Info, Loader2, Mic, Keyboard, X, Trash2, Undo2 } from "lucide-react";
import { useCapture, type CaptureEntry } from "@/stores/capture";
import { useTasks } from "@/stores/tasks";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menus";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The inline activity log under Quick Capture.
 *
 * Replaces the toast for this surface: a request appears here the moment it is
 * sent, shows that it's being worked on, then fills in with the assistant's
 * reply. Nothing disappears on a timer.
 *
 * Timestamps live behind the "i" button rather than on the row — they matter
 * when you're checking what happened, and are noise the rest of the time.
 */
export function CaptureActivity() {
  const entries = useCapture((s) => s.entries);
  const hydrate = useCapture((s) => s.hydrate);
  const clear = useCapture((s) => s.clear);

  // localStorage is read after mount, never during render — reading it inline
  // would diverge from the server-rendered markup and fail hydration.
  useEffect(() => { hydrate(); }, [hydrate]);

  if (!entries.length) return null;

  return (
    <div className="mt-2">
      <AnimatePresence initial={false}>
        {entries.map((entry) => (
          <motion.div
            key={entry.id}
            layout
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.18 }}
            className="mb-1.5"
          >
            <ActivityRow entry={entry} />
          </motion.div>
        ))}
      </AnimatePresence>

      {entries.length > 1 && (
        <button
          onClick={clear}
          className="mt-0.5 ml-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Trash2 className="h-3 w-3" />
          Clear history
        </button>
      )}
    </div>
  );
}

function ActivityRow({ entry }: { entry: CaptureEntry }) {
  const remove = useCapture((s) => s.remove);
  const resolve = useCapture((s) => s.resolve);
  const reload = useTasks((s) => s.load);
  const [undoing, setUndoing] = useState(false);
  const processing = entry.status === "processing";
  const failed = entry.status === "error";

  /**
   * Put back what a spoken delete removed. Dictation mishears, and hands-free
   * mode has no confirmation step, so this is the safety net that makes voice
   * deletion reasonable to offer at all.
   */
  async function undo() {
    if (!entry.undo || undoing) return;
    setUndoing(true);
    try {
      const res = await fetch("/api/undo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshot: entry.undo }),
      });
      if (!res.ok) throw new Error("restore failed");
      resolve(entry.id, {
        undone: true,
        reply: `Restored the ${entry.undo.kind} "${entry.undo.title}".`,
      });
      reload("scope=today");
    } catch {
      resolve(entry.id, { status: "error", error: "Could not restore that." });
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div
      className={cn(
        "surface flex items-start gap-2.5 px-3 py-2 text-sm",
        failed && "border-[hsl(var(--destructive)/0.35)]",
      )}
    >
      <span className="mt-0.5 shrink-0">
        {processing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : failed ? (
          <X className="h-3.5 w-3.5 text-[hsl(var(--destructive))]" />
        ) : (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        {/* The request, always shown — this is the record of what was asked.
            Session events (voice mode ending) have no request to echo. */}
        {!entry.info && (
          <p className="text-xs text-muted-foreground truncate">{entry.text}</p>
        )}

        <p
          className={cn(
            "mt-0.5",
            processing && "text-muted-foreground italic",
            failed && "text-[hsl(var(--destructive))]",
          )}
        >
          {processing
            ? "Working on it…"
            : failed
              ? entry.error || "Something went wrong."
              : entry.reply || "Done."}
        </p>

        {entry.undo && !entry.undone && entry.status === "done" && (
          <button
            onClick={undo}
            disabled={undoing}
            className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {undoing
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Undo2 className="h-3 w-3" />}
            Undo delete
          </button>
        )}
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Request details"
          >
            <Info className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <Details entry={entry} onDismiss={() => remove(entry.id)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Details({ entry, onDismiss }: { entry: CaptureEntry; onDismiss: () => void }) {
  const took = entry.respondedAt ? entry.respondedAt - entry.requestedAt : null;

  return (
    <div className="space-y-2.5 text-xs">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Requested</p>
        <p className="mt-0.5 tabular-nums">{formatStamp(entry.requestedAt)}</p>
      </div>

      {entry.respondedAt && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Replied</p>
          <p className="mt-0.5 tabular-nums">
            {formatStamp(entry.respondedAt)}
            {took != null && (
              <span className="text-muted-foreground"> · {formatDuration(took)}</span>
            )}
          </p>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-muted-foreground">
        {entry.source === "voice" ? <Mic className="h-3 w-3" /> : <Keyboard className="h-3 w-3" />}
        <span>{entry.source === "voice" ? "Dictated" : "Typed"}</span>
        {entry.intent && (
          <>
            <span aria-hidden>·</span>
            <span className="font-mono text-[10px]">{entry.intent}</span>
          </>
        )}
      </div>

      {entry.created && summarizeCreated(entry.created) && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Created</p>
          <p className="mt-0.5">{summarizeCreated(entry.created)}</p>
        </div>
      )}

      <div className="pt-1 border-t border-border">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Full request</p>
        <p className="mt-0.5 break-words">{entry.text}</p>
      </div>

      <button
        onClick={onDismiss}
        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        Remove from history
      </button>
    </div>
  );
}

function summarizeCreated(c: { tasks: number; goal: boolean; note: boolean }): string | null {
  const bits: string[] = [];
  if (c.tasks) bits.push(`${c.tasks} task${c.tasks === 1 ? "" : "s"}`);
  if (c.goal) bits.push("1 goal");
  if (c.note) bits.push("1 note");
  return bits.length ? bits.join(", ") : null;
}

/** Absolute date + time — the point of the popover is precision. */
function formatStamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", second: "2-digit",
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
