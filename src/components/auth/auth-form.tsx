"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/primitives";
import { GoogleButton } from "@/components/auth/google-button";

/**
 * Login and sign-up share one form: the fields, the Google button and the
 * error handling are identical, and only the submit path differs. Sign-up
 * registers through `/api/auth/signup` and then signs in with the same
 * credentials, so a new user never has to type them twice.
 */
export function AuthForm({
  mode,
  callbackUrl = "/dashboard",
  error: initialError,
  googleClientId,
  googleNonce,
}: {
  mode: "login" | "signup";
  callbackUrl?: string;
  /** Auth.js redirects here with ?error=... when a sign-in attempt fails. */
  error?: string;
  /**
   * The public Google client ID, or null when unset. Rendering the button
   * without one just produces a broken GIS widget, so it is omitted instead.
   */
  googleClientId: string | null;
  /** Per-page-load nonce, minted server-side, to stop token replay. */
  googleNonce: string;
}) {
  const router = useRouter();
  const isSignup = mode === "signup";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Opt-in rather than default: calendar access is a second consent popup, and
  // pre-ticking a permission prompt on someone's behalf isn't a fair default.
  const [withCalendar, setWithCalendar] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? describeAuthError(initialError) : null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isSignup) {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, name: name.trim() || undefined }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? "Could not create your account.");
      }

      // `redirect: false` so a bad password re-renders this form with a message
      // instead of bouncing to Auth.js's own error page.
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        throw new Error(
          isSignup
            ? "Account created, but signing in failed. Try logging in."
            : "That email and password don't match.",
        );
      }
      toast.success(isSignup ? "Welcome to Life OS." : "Welcome back.");
      router.push(callbackUrl);
      // The auth cookie changes what the server renders, so the cached RSC
      // payload for the destination has to be dropped.
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {isSignup ? "Get started" : "Welcome back"}
        </p>
        <h1 className="mt-1 font-display text-3xl italic">
          {isSignup ? "Make a Life OS." : "Sign in."}
        </h1>
      </div>

      {googleClientId ? (
        <>
          <GoogleButton
            clientId={googleClientId}
            nonce={googleNonce}
            callbackUrl={callbackUrl}
            withCalendar={withCalendar}
          />
          <label className="mt-3 flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={withCalendar}
              onChange={(e) => setWithCalendar(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border accent-[hsl(var(--foreground))]"
            />
            <span>
              Also connect Google Calendar
              {/* Deliberately explicit: this grant lasts about an hour and
                  cannot renew itself, so promising "synced" would be a lie. */}
              <span className="block text-muted-foreground/70">
                Asks once more, for this session only — about an hour. Lasting sync is set up in
                Settings.
              </span>
            </span>
          </label>
        </>
      ) : (
        // Silently omitting the button reads as a broken page. Say why, and
        // only in development — an end user can't act on it, but whoever is
        // running `npm run dev` can.
        process.env.NODE_ENV === "development" && (
          <div className="rounded-md border border-dashed border-border p-3">
            <p className="text-xs font-medium">Google sign-in is off</p>
            <p className="mt-1 text-xs text-muted-foreground">
              <code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> is not set in <code>.env</code>. It is a
              public value, not a secret. Add it and restart the dev server — setup steps are in{" "}
              <code>.env.example</code>, and <code>npm run check:google</code> verifies it.
            </p>
          </div>
        )
      )}

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={submit} className="space-y-3">
        {isSignup && (
          <div className="grid gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="What should I call you?" autoComplete="name"
            />
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email" type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com" autoComplete="email"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password" type="password" required value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isSignup ? "At least 8 characters" : "••••••••"}
            autoComplete={isSignup ? "new-password" : "current-password"}
            minLength={isSignup ? 8 : undefined}
          />
        </div>

        {error && (
          <p role="alert" className="text-xs text-[hsl(var(--destructive))]">{error}</p>
        )}

        <Button type="submit" disabled={busy} className="w-full">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isSignup ? "Create account" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-xs text-muted-foreground">
        {isSignup ? "Already have an account? " : "No account yet? "}
        <Link
          href={isSignup ? "/login" : "/signup"}
          className="text-foreground underline underline-offset-4"
        >
          {isSignup ? "Sign in" : "Create one"}
        </Link>
      </p>
    </div>
  );
}

/** Auth.js error codes are opaque; these are the ones a user can act on. */
function describeAuthError(code: string): string {
  switch (code) {
    case "AccessDenied":
      return "Google sign-in was cancelled.";
    case "Configuration":
      return "Sign-in isn't configured on this server. Check NEXT_PUBLIC_GOOGLE_CLIENT_ID.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
