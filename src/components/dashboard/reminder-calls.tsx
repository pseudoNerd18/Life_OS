"use client";
import { useState } from "react";
import { Phone, PhoneOff, Loader2, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { phoneZ } from "@/lib/validation";
import { cn } from "@/lib/utils";

/**
 * Reminder calls — save a number here and the phone rings two minutes before
 * anything on today's calendar starts. The sweep that does the dialling lives
 * in `lib/calls/reminders.ts`.
 *
 * It sits on the Today page rather than in Settings on purpose: this is the
 * screen you check before the day starts, so it's where you'd notice a number
 * that's wrong or a mute you forgot to lift.
 */
export function ReminderCalls({
  initialPhone,
  initialEnabled,
  configured,
}: {
  initialPhone: string | null;
  initialEnabled: boolean;
  configured: boolean;
}) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [saved, setSaved] = useState(initialPhone);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = phone.trim() !== (saved ?? "");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Could not save. Try again.");
      return (await res.json()) as { phone: string | null; callReminders: boolean };
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const value = phone.trim();
    // Validate with the same schema the route uses, so a bad number is caught
    // here instead of coming back as a 400 with a flattened Zod error.
    if (value) {
      const parsed = phoneZ.safeParse(value);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "That doesn't look like a phone number.");
        return;
      }
    }
    try {
      const u = await patch({ phone: value || null });
      setSaved(u.phone);
      setPhone(u.phone ?? "");
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  async function toggle() {
    const next = !enabled;
    setEnabled(next); // optimistic — a toggle that lags feels broken
    try {
      await patch({ callReminders: next });
    } catch (e) {
      setEnabled(!next);
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  return (
    <section className="surface shadow-soft p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">Reminder calls</h2>
        {saved && (
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
              "disabled:opacity-50",
              enabled
                ? "border-transparent bg-foreground text-background"
                : "border-input text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={enabled}
          >
            {enabled ? <Phone className="h-3 w-3" /> : <PhoneOff className="h-3 w-3" />}
            {enabled ? "On" : "Muted"}
          </button>
        )}
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        {saved && enabled
          ? "We'll ring you two minutes before each event starts."
          : saved
            ? "Muted. Your number is saved — switch it back on any time."
            : "Add a number and we'll ring it two minutes before each event starts."}
      </p>

      <div className="mt-4 flex items-center gap-2">
        <Input
          type="tel"
          inputMode="tel"
          // The placeholder carries the country code because that's the part
          // people leave off, and E.164 is what Twilio requires.
          placeholder="+14155552671"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) void save();
          }}
          aria-label="Phone number for reminder calls"
          aria-invalid={Boolean(error)}
          disabled={busy}
        />
        <Button onClick={() => void save()} disabled={busy || !dirty} className="shrink-0">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : justSaved ? (
            <Check className="h-4 w-4" />
          ) : (
            "Save"
          )}
        </Button>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {!configured && (
        // Worth saying plainly: without Twilio credentials the number saves
        // fine and nothing ever rings, which is a confusing way to find out.
        <p className="mt-3 text-xs text-muted-foreground">
          Calling isn&apos;t configured on this server yet — set{" "}
          <code className="text-[11px]">TWILIO_ACCOUNT_SID</code>,{" "}
          <code className="text-[11px]">TWILIO_AUTH_TOKEN</code> and{" "}
          <code className="text-[11px]">TWILIO_FROM_NUMBER</code>. See{" "}
          <code className="text-[11px]">.env.example</code>.
        </p>
      )}
    </section>
  );
}
