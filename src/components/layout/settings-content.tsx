"use client";
import { useState } from "react";
import { Check, X, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import {
  ConnectedCalendars,
  type CalendarAccountShape,
} from "@/components/calendar/connected-calendars";

interface UserShape {
  email: string | null;
  name: string | null;
  image: string | null;
  timezone: string;
}

const TZS = [
  "Asia/Kolkata", "Asia/Tokyo", "Asia/Singapore", "Asia/Dubai",
  "Europe/London", "Europe/Berlin", "Europe/Paris",
  "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Australia/Sydney", "UTC",
];

export function SettingsContent({
  user,
  calendarAccounts,
  googleConfigured,
  googleClientId,
}: {
  user: UserShape;
  calendarAccounts: CalendarAccountShape[];
  /** A client secret is present, so lasting (refreshable) calendar sync works. */
  googleConfigured: boolean;
  /** Public client ID — enables the secret-free browser grant. */
  googleClientId: string | null;
}) {
  const [name, setName] = useState(user.name ?? "");
  const [tz, setTz] = useState(user.timezone);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() || null, timezone: tz }),
      });
      if (!res.ok) throw new Error();
      toast.success("Saved.");
    } catch {
      toast.error("Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-6 lg:px-10 py-8 max-w-3xl mx-auto w-full">
      <header className="mb-10">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-mono">Settings</p>
        <h1 className="mt-2 font-display text-4xl italic">Profile &amp; preferences.</h1>
      </header>

      <Section title="Profile" subtitle="How the assistant addresses you.">
        <div className="grid gap-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="What should I call you?" />
          </Field>
          <Field label="Timezone">
            <select
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {TZS.map((z) => <option key={z}>{z}</option>)}
            </select>
          </Field>
          <div className="pt-2">
            <Button onClick={save} disabled={saving} size="sm">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </Section>

      <Section
        title="Calendars"
        subtitle="Two-way Google Calendar sync — events come in, dated tasks go out."
      >
        <ConnectedCalendars
          accounts={calendarAccounts}
          configured={googleConfigured}
          googleClientId={googleClientId}
        />
      </Section>

      <Section title="AI services" subtitle="Local model health.">
        <HealthRow label="Local LLM (Ollama)" endpoint="/api/ai/health/ollama" />
        <HealthRow label="Voice (Whisper)" endpoint="/api/ai/health/whisper" />
      </Section>

      <Section title="Account" subtitle="Signed in.">
        <div className="flex items-center justify-between text-sm">
          <div>
            <p>{user.email}</p>
            <p className="text-xs text-muted-foreground">Data is tied to this account, not this device.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => signOut({ callbackUrl: "/" })}>
            Sign out
          </Button>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="surface shadow-soft p-6 mb-6">
      <div className="mb-5">
        <h2 className="text-sm font-medium">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function HealthRow({ label, endpoint }: { label: string; endpoint: string }) {
  // "warn" is a distinct state on purpose: `ok: true` only means the service
  // answered. Ollama can be perfectly healthy while the configured model isn't
  // installed — a green tick there sends you hunting the wrong problem.
  const [state, setState] = useState<"idle" | "checking" | "ok" | "warn" | "fail">("idle");
  const [detail, setDetail] = useState<string>("");

  async function check() {
    setState("checking");
    try {
      const r = await fetch(endpoint);
      const j = await r.json();
      if (!j.ok) {
        setState("fail");
        setDetail(j.error ?? "unreachable");
      } else if (j.present === false) {
        setState("warn");
        setDetail(j.hint ?? `${j.model ?? "model"} is not installed`);
      } else {
        setState("ok");
        setDetail(j.model ?? j.mode ?? "");
      }
    } catch (e) {
      setState("fail"); setDetail((e as Error).message);
    }
  }

  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <div className="min-w-0">
        <p>{label}</p>
        {detail && (
          <p className={cn(
            "text-xs break-words",
            state === "warn" ? "text-amber-600" : "text-muted-foreground",
          )}>
            {detail}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {state === "ok" && <Check className="h-4 w-4 text-emerald-600" />}
        {state === "warn" && <AlertTriangle className="h-4 w-4 text-amber-600" />}
        {state === "fail" && <X className="h-4 w-4 text-[hsl(var(--destructive))]" />}
        <Button onClick={check} size="sm" variant="outline" disabled={state === "checking"}>
          {state === "checking" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
        </Button>
      </div>
    </div>
  );
}
