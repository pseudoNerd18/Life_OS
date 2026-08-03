"use client";
import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { VoiceRecorder } from "@/components/voice/voice-recorder";
import { useAssistant } from "@/stores/assistant";
import { useTasks } from "@/stores/tasks";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Remind me to go to the gym tomorrow evening",
  "Plan my GATE exam preparation for the next 4 months",
  "Take vitamin B12 every 3 days",
  "Create notes about transformers and LLMs",
  "Block 2 hours daily for DSA practice",
];

export function AssistantChat() {
  const { messages, sending, push, patch, setSending } = useAssistant();
  const reloadTasks = useTasks((s) => s.load);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);

  // Auto-scroll to the latest message. Wrapped in rAF so React strict-mode's
  // double-invoke coalesces into a single scroll instead of a visible
  // double-jump. The first scroll is instant (no animation on mount).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const behavior: ScrollBehavior = didInitialScroll.current ? "smooth" : "auto";
    didInitialScroll.current = true;
    const id = requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior });
    });
    return () => cancelAnimationFrame(id);
  }, [messages.length]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userMsg = { id: nanoid(), role: "USER" as const, content: trimmed, createdAt: Date.now() };
    push(userMsg);
    const pendingId = nanoid();
    push({ id: pendingId, role: "ASSISTANT", content: "", createdAt: Date.now(), pending: true });
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { reply: string; intent: string; extracted: object };
      patch(pendingId, { content: data.reply, intent: data.extracted as never, pending: false });
      // refresh tasks so newly-created ones appear in other panes
      reloadTasks();
    } catch (e) {
      patch(pendingId, {
        content: "Something went wrong — check Ollama is running, then try again.",
        pending: false,
      });
      console.error(e);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 lg:px-10 py-8">
        {messages.length === 0 ? (
          <EmptyState onPick={send} />
        ) : (
          <div className="max-w-2xl mx-auto space-y-6">
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex gap-3",
                    m.role === "USER" ? "justify-end" : "justify-start",
                  )}
                >
                  {m.role === "ASSISTANT" && (
                    <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </div>
                  )}
                  <div
                    className={cn(
                      "rounded-xl px-4 py-2.5 text-sm max-w-[80%]",
                      m.role === "USER"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary/60 text-foreground",
                    )}
                  >
                    {m.pending ? (
                      <Loader2 className="h-4 w-4 animate-spin opacity-70" />
                    ) : (
                      <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <Composer
        input={input}
        setInput={setInput}
        onSend={() => send(input)}
        onTranscript={(t) => setInput((prev) => (prev ? prev + " " + t : t))}
        sending={sending}
      />
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="max-w-xl mx-auto text-center pt-12 lg:pt-24">
      <h1 className="font-display text-4xl lg:text-5xl italic tracking-tight">
        How can I help today?
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Type or speak naturally. I&apos;ll handle the structure.
      </p>
      <div className="mt-10 grid gap-2 text-left">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="surface px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors text-left"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({
  input, setInput, onSend, onTranscript, sending,
}: {
  input: string; setInput: (s: string) => void;
  onSend: () => void; onTranscript: (t: string) => void; sending: boolean;
}) {
  return (
    <div className="border-t border-border bg-background/80 backdrop-blur px-6 lg:px-10 py-4">
      <div className="max-w-2xl mx-auto">
        <div className="surface flex items-end gap-2 p-2 shadow-soft">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Tell me what's on your mind…"
            className="border-0 shadow-none focus-visible:ring-0 min-h-[44px] max-h-[200px] resize-none px-2 py-2"
          />
          <div className="flex items-center gap-1 pb-1">
            <VoiceRecorder onTranscript={onTranscript} />
            <Button onClick={onSend} disabled={sending || !input.trim()} size="icon" className="h-8 w-8">
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground text-center">
          Enter to send · Shift+Enter for newline · Mic to dictate
        </p>
      </div>
    </div>
  );
}
