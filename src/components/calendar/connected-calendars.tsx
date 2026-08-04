"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Loader2, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  useGoogleCalendarGrant,
  type CalendarGrant,
} from "@/components/auth/use-google-calendar-grant";

/**
 * What to say when Google refuses. The "not a tester" case is by far the most
 * likely during development and the least self-explanatory: calendar scopes are
 * *sensitive*, so an app still in Testing mode allows them only for accounts
 * listed as test users — even though plain sign-in works for anyone.
 */
function formatSyncedAt(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

const GRANT_MESSAGES: Record<
  Extract<CalendarGrant, { ok: false }>["reason"],
  { title: string; detail?: string }
> = {
  "not-a-tester": {
    title: "This Google account isn't an approved tester",
    detail:
      "Calendar needs a sensitive scope, so while the app is in Testing mode only listed test users can grant it. Add this address under Google Auth Platform → Audience → Test users.",
  },
  cancelled: { title: "Calendar access was not granted" },
  blocked: {
    title: "The Google popup was blocked",
    detail: "Allow popups for this site and try again.",
  },
  unavailable: { title: "Could not reach Google" },
};

export interface CalendarAccountShape {
  id: string;
  provider: string;
  email: string;
  lastSyncedAt: string | null;
  isActive: boolean;
  /** True when connected by a browser grant: expires and cannot self-renew. */
  sessionOnly: boolean;
  expiresAt: string | null;
}

/**
 * Connect / disconnect / sync UI for external calendars.
 *
 * Rendered both in Settings and on the calendar page, so it takes its accounts
 * as a prop and calls `router.refresh()` after a mutation rather than owning a
 * second copy of server state.
 */
export function ConnectedCalendars({
  accounts,
  configured,
  googleClientId,
}: {
  accounts: CalendarAccountShape[];
  /** A client secret is present, so lasting (refreshable) sync is possible. */
  configured: boolean;
  /** Public client ID — enables the browser grant, which needs no secret. */
  googleClientId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const requestCalendar = useGoogleCalendarGrant(googleClientId);

  /**
   * Connect using a browser-granted token. Works with no client secret, at the
   * cost of expiring in about an hour with no way to renew silently.
   */
  async function connectForSession() {
    setBusy("session");
    try {
      const grant = await requestCalendar();
      if (!grant.ok) {
        toast.error(GRANT_MESSAGES[grant.reason].title, {
          description: GRANT_MESSAGES[grant.reason].detail ?? grant.detail,
        });
        return;
      }
      const res = await fetch("/api/calendar/google/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessToken: grant.accessToken }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) throw new Error(j.error ?? "Could not connect.");

      const pulled = (j.report?.pulled ?? 0) + (j.report?.appliedRemote ?? 0);
      const pushed = (j.report?.pushed ?? 0) + (j.report?.updated ?? 0);
      toast.success(`Connected ${j.email} for this session`, {
        description: j.error
          ? `Synced with problems: ${j.error}`
          : `${pulled} in, ${pushed} out · expires in about an hour`,
      });
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function syncNow() {
    setBusy("sync");
    try {
      const res = await fetch("/api/calendar/sync", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Sync failed");

      const t = (j.reports ?? []).reduce(
        (a: { in: number; out: number }, r: { pulled: number; appliedRemote: number; pushed: number; updated: number }) => ({
          in: a.in + r.pulled + r.appliedRemote,
          out: a.out + r.pushed + r.updated,
        }),
        { in: 0, out: 0 },
      );
      const conflicts = (j.reports ?? []).flatMap((r: { conflicts: unknown[] }) => r.conflicts);
      const problems = [
        ...(j.errors ?? []),
        ...(j.reports ?? []).flatMap((r: { errors: string[] }) => r.errors),
      ];

      toast.success(`Synced — ${t.in} in, ${t.out} out`, {
        description: [
          conflicts.length ? `${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""} resolved` : null,
          problems.length ? `${problems.length} item${problems.length > 1 ? "s" : ""} failed` : null,
        ].filter(Boolean).join(" · ") || undefined,
      });
      // Surface failures properly — a green toast alone would hide them.
      if (problems.length) toast.error(problems[0]);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(id: string, email: string) {
    if (!confirm(`Disconnect ${email}?\n\nEvents pushed to Google stay in Google, and your tasks stay here — they're just unlinked.`)) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/calendar/accounts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to disconnect");
      toast.success(`Disconnected ${email}`);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!configured && !googleClientId) {
    return (
      <div className="flex items-start gap-2.5 text-xs text-muted-foreground">
        <TriangleAlert className="h-3.5 w-3.5 mt-px shrink-0" />
        <p>
          Google isn&rsquo;t configured. Set <code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> in{" "}
          <code>.env</code> and restart the dev server. Run{" "}
          <code>npm run check:google</code> to verify.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {accounts.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate">
              <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {a.email}
              {!a.isActive && (
                <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--destructive))]">
                  reconnect needed
                </span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {a.lastSyncedAt
                ? `Last synced ${formatSyncedAt(a.lastSyncedAt)}`
                : "Not synced yet"}
              {a.sessionOnly && (
                <span className="block text-muted-foreground/70">
                  This session only —{" "}
                  {a.expiresAt && new Date(a.expiresAt) > new Date()
                    ? `expires ${new Date(a.expiresAt).toLocaleTimeString("en-US", { timeStyle: "short" })}`
                    : "expired, reconnect to sync again"}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => disconnect(a.id, a.email)}
            disabled={busy === a.id}
            className="text-xs text-muted-foreground hover:text-[hsl(var(--destructive))] inline-flex items-center gap-1.5 shrink-0"
          >
            {busy === a.id
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Trash2 className="h-3 w-3" />}
            Disconnect
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {googleClientId && accounts.length === 0 && (
          <Button variant="outline" size="sm" onClick={connectForSession} disabled={busy === "session"}>
            {busy === "session"
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Calendar className="h-3.5 w-3.5" />}
            Connect for this session
          </Button>
        )}
        {/* A plain link, not fetch: the code flow needs a top-level navigation. */}
        {configured && (
          <Button asChild variant="ghost" size="sm">
            <a href="/api/calendar/google/connect">
              {accounts.length ? "Connect another (lasting)" : "Connect with lasting sync"}
            </a>
          </Button>
        )}
        {accounts.length > 0 && (
          <Button variant="ghost" size="sm" onClick={syncNow} disabled={busy === "sync"}>
            {busy === "sync"
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            Sync now
          </Button>
        )}
      </div>

      {accounts.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Two-way: Google events appear here, and tasks with a date become Google events.
          {!configured && (
            <span className="block text-muted-foreground/70">
              Background sync needs a client secret on the server; without one a connection
              lasts about an hour.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
