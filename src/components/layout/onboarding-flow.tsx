"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/primitives";
import { VoiceRecorder } from "@/components/voice/voice-recorder";

const TZS = [
  "Asia/Kolkata", "Asia/Tokyo", "Asia/Singapore", "Asia/Dubai",
  "Europe/London", "Europe/Berlin", "Europe/Paris",
  "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Australia/Sydney",
];

export function OnboardingFlow({ defaultName, defaultTz }: { defaultName: string; defaultTz: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(defaultName);
  const [tz, setTz] = useState(defaultTz);
  const [firstInput, setFirstInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function finish() {
    setBusy(true);
    try {
      // Persist profile prefs
      await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, timezone: tz, complete: true }),
      });
      // Fire the user's first capture, if any
      if (firstInput.trim()) {
        await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: firstInput.trim() }),
        });
      }
      router.replace("/dashboard");
    } catch {
      toast.error("Could not finish setup.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 grain relative">
      <div className="w-full max-w-md">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="0"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="text-center"
            >
              <Sparkles className="h-5 w-5 mx-auto text-muted-foreground" strokeWidth={1.5} />
              <h1 className="mt-6 font-display text-5xl italic">Hello.</h1>
              <p className="mt-3 text-muted-foreground">
                Three quick questions, then we&apos;re in.
              </p>
              <Button onClick={() => setStep(1)} className="mt-10" size="lg">
                Begin <ArrowRight className="h-4 w-4" />
              </Button>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div key="1" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <h2 className="font-display text-3xl italic">What should I call you?</h2>
              <div className="mt-6 space-y-4">
                <div>
                  <Label htmlFor="n">Name</Label>
                  <Input id="n" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="tz">Timezone</Label>
                  <select
                    id="tz"
                    value={tz}
                    onChange={(e) => setTz(e.target.value)}
                    className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {TZS.map((z) => <option key={z}>{z}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-8 flex justify-between">
                <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
                <Button onClick={() => setStep(2)}>Continue <ArrowRight className="h-4 w-4" /></Button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="2" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <h2 className="font-display text-3xl italic">Try it out.</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Tell me something to do — or speak. I&apos;ll handle the rest.
              </p>
              <div className="mt-5 surface p-2.5 flex items-end gap-2">
                <Input
                  value={firstInput}
                  onChange={(e) => setFirstInput(e.target.value)}
                  placeholder="e.g. Remind me to call mom this Friday"
                  className="border-0 shadow-none focus-visible:ring-0"
                />
                <VoiceRecorder onTranscript={(t) => setFirstInput((p) => (p ? `${p} ${t}` : t))} />
              </div>
              <div className="mt-8 flex justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                <Button onClick={finish} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Finish setup
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-12 flex justify-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-1 w-6 rounded-full transition-colors ${i <= step ? "bg-foreground" : "bg-border"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
