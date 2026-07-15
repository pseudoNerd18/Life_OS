"use client";
import { useCallback, useRef, useState } from "react";
import { Send, Sparkles, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HandsFree, DICTATION_LANGUAGES } from "@/components/voice/hands-free";
import { CaptureActivity } from "@/components/dashboard/capture-activity";
import { useTasks } from "@/stores/tasks";
import { useCapture } from "@/stores/capture";
import { useVoice } from "@/stores/assistant";
import { cn } from "@/lib/utils";

/**
 * Quick Capture.
 *
 * Voice works like a conversation, not a walkie-talkie: turn voice mode on once
 * and the words appear in the box as they're recognised, the pause at the end of
 * your sentence is the cue to act, and it goes straight back to listening. See
 * lib/voice/use-dictation.ts for how the utterance boundary is found.
 *
 * Results land in the activity log below rather than a toast — the assistant's
 * interpretation is the product here, so it gets a durable record.
 */
export function QuickCapture({ liveText = false }: { liveText?: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  /** Live, not-yet-final dictation. Shown in the box but not owned by it. */
  const [interim, setInterim] = useState("");
  const sourceRef = useRef<"text" | "voice">("text");
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Mirror of `text` for reading inside audio callbacks.
   *
   * Not a `setText(prev => …)` updater: React StrictMode deliberately invokes
   * updaters twice to surface impurity, so submitting from inside one sent every
   * dictated sentence to the assistant twice.
   */
  const textRef = useRef("");

  const language = useVoice((s) => s.language);
  const setLanguage = useVoice((s) => s.setLanguage);

  const reload = useTasks((s) => s.load);
  const begin = useCapture((s) => s.begin);
  const resolve = useCapture((s) => s.resolve);
  const fail = useCapture((s) => s.fail);
  const note = useCapture((s) => s.note);

  /**
   * `submit` takes the message explicitly rather than reading state, because
   * dictation calls it from inside an audio callback where a stale closure over
   * `text` would send the previous sentence.
   */
  const submit = useCallback(async (msg: string, source: "text" | "voice") => {
    const message = msg.trim();
    if (!message) return;

    const id = begin(message, source);
    textRef.current = "";
    setText("");
    setInterim("");
    sourceRef.current = "text";
    setBusy(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error
            ?? (res.status === 429
              ? "Too many requests — give it a minute."
              : `The assistant returned ${res.status}.`),
        );
      }

      const data = (await res.json()) as {
        reply?: string;
        intent?: string;
        created?: { taskIds?: string[]; goalId?: string; noteId?: string };
        undo?: { kind: "task" | "note" | "goal"; title: string; data: Record<string, unknown> };
      };

      resolve(id, {
        status: "done",
        reply: data.reply || "Done.",
        intent: data.intent,
        created: {
          tasks: data.created?.taskIds?.length ?? 0,
          goal: Boolean(data.created?.goalId),
          note: Boolean(data.created?.noteId),
        },
        undo: data.undo,
      });
      reload("scope=today");
    } catch (e) {
      resolve(id, { status: "error", error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [begin, resolve, reload]);

  /** A finished sentence: act on it immediately, no confirmation tap. */
  const onUtterance = useCallback((spoken: string) => {
    setInterim("");
    // Anything already typed stays in front of what was said.
    const typed = textRef.current.trim();
    const combined = typed ? `${typed} ${spoken}` : spoken;
    void submit(combined, typed ? "text" : "voice");
  }, [submit]);

  // While speaking, the box shows the live transcript; the committed value is
  // whatever was typed. Keeping them separate means a partial can never clobber
  // something you typed, and an abandoned utterance leaves nothing behind.
  const shown = interim || text;
  const dictating = interim.length > 0;

  return (
    <div className="mt-6">
      <div className="surface p-2.5 shadow-soft flex items-center gap-2">
        <Sparkles className="h-4 w-4 mx-2 text-muted-foreground shrink-0" />
        <Input
          ref={inputRef}
          value={shown}
          onChange={(e) => {
            setInterim("");
            textRef.current = e.target.value;
            setText(e.target.value);
            sourceRef.current = "text";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(shown, sourceRef.current);
            }
          }}
          placeholder="Add a task, ask a question, plan a goal…"
          className={cn(
            "border-0 shadow-none focus-visible:ring-0 bg-transparent",
            dictating && "italic text-foreground/80",
          )}
        />
        <HandsFree
          language={language}
          onLanguageChange={setLanguage}
          languages={DICTATION_LANGUAGES}
          onUtterance={onUtterance}
          // "That'll be all" ends the session; note it so the log shows why.
          onStopPhrase={() => {
            setInterim("");
            note("Voice mode off — you said that was all.");
          }}
          onInterim={setInterim}
          liveText={liveText}
          onError={(message) => fail("(dictation)", "voice", message)}
        />
        <Button
          onClick={() => void submit(shown, sourceRef.current)}
          size="icon"
          className="h-8 w-8"
          disabled={busy || !shown.trim()}
          aria-label="Send"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <CaptureActivity />
    </div>
  );
}
