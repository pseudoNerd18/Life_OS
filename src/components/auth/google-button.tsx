"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { useGoogleCalendarGrant } from "@/components/auth/use-google-calendar-grant";
import { loadGsi } from "@/lib/auth/gsi-loader";

/**
 * Read the applied theme from the document instead of `useTheme()`.
 *
 * next-themes reports `undefined` until it has mounted and read the stored
 * preference, and GIS draws its button once with no way to restyle it after —
 * so a hydration-timing dependency here means a light button on a dark page.
 * The `dark` class is what actually decides the page's colours and is readable
 * synchronously.
 */
function isDark(): boolean {
  return typeof document !== "undefined"
    && document.documentElement.classList.contains("dark");
}

/**
 * Google Identity Services sign-in.
 *
 * Renders Google's own button, because GIS only hands a credential back to a
 * button it controls — a custom element can't start the flow. That means its
 * appearance is configured through GIS options rather than CSS, and it has to
 * be redrawn whenever the theme or the available width changes.
 *
 * `nonce` is minted per page load on the server and travels inside the ID token,
 * so a captured token can't be replayed into a second sign-in.
 */
export function GoogleButton({
  clientId,
  nonce,
  callbackUrl = "/dashboard",
  withCalendar = false,
}: {
  clientId: string;
  nonce: string;
  callbackUrl?: string;
  /** Also ask for calendar access straight after signing in. */
  withCalendar?: boolean;
}) {
  const router = useRouter();
  const requestCalendar = useGoogleCalendarGrant(clientId);
  const wantCalendar = useRef(withCalendar);
  wantCalendar.current = withCalendar;
  const holder = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"signin" | "calendar">("signin");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const handleCredential = useCallback(
    async (response: { credential?: string }) => {
      if (!response.credential) return;
      setBusy(true);
      setStage("signin");
      setError(null);
      try {
        const result = await signIn("google", {
          credential: response.credential,
          nonce,
          redirect: false,
        });
        if (result?.error) throw new Error(result.error);

        // Calendar is a second, separate consent: the ID token above proves who
        // you are and grants no API access. Declining it, or the popup being
        // blocked, must not undo a successful sign-in — so this is best-effort.
        if (wantCalendar.current) {
          setStage("calendar");
          try {
            const grant = await requestCalendar();
            if (grant.ok) {
              await fetch("/api/calendar/google/session", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ accessToken: grant.accessToken }),
              });
            } else {
              // Sign-in already succeeded, so this is a note rather than a
              // failure — the calendar can be connected later from Settings.
              console.warn("[calendar] not connected at sign-in:", grant.reason, grant.detail);
            }
          } catch (err) {
            console.error("[calendar] session grant failed:", err);
          }
        }

        router.push(callbackUrl);
        // The session cookie changes what the server renders, so the cached RSC
        // payload for the destination has to be dropped.
        router.refresh();
      } catch (err) {
        // Log the real reason; show the user something actionable. Auth.js can
        // reject with an empty message, so never surface it raw.
        console.error("[auth] Google sign-in failed:", err);
        setError("Google sign-in failed. Please try again.");
        setBusy(false);
      }
    },
    [nonce, callbackUrl, router, requestCalendar],
  );

  /** (Re)draw Google's button to match the current theme and container width. */
  const render = useCallback(() => {
    const id = window.google?.accounts?.id;
    const el = holder.current;
    if (!id || !el) return;

    id.initialize({
      client_id: clientId,
      callback: handleCredential,
      nonce,
      // One Tap is deliberately off: it appears unbidden, and on a page whose
      // whole purpose is signing in, an explicit button is clearer.
      auto_select: false,
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true,
    });

    // GIS needs an explicit pixel width (it clamps to 200–400); without one the
    // button sizes to its label and sits narrower than the form beside it.
    const measured = Math.round(el.getBoundingClientRect().width);
    el.innerHTML = "";
    id.renderButton(el, {
      type: "standard",
      theme: isDark() ? "filled_black" : "outline",
      size: "large",
      // Matches the app's inputs and primary button, which are rounded-md.
      shape: "rectangular",
      text: "continue_with",
      logo_alignment: "left",
      width: Math.min(400, Math.max(200, measured || 320)),
    });
    setReady(true);
  }, [clientId, nonce, handleCredential]);

  // Load GIS through the shared loader rather than next/script: `onLoad` never
  // fires for an already-cached script, which left the button unrendered on a
  // second mount.
  useEffect(() => {
    let cancelled = false;
    loadGsi().then((ok) => {
      if (cancelled) return;
      if (ok) render();
      else setError("Google sign-in is unavailable right now.");
    });
    return () => { cancelled = true; };
  }, [render]);

  // Redraw on a theme toggle and on resize: both are baked into the button at
  // draw time, so without this it stays stale until the next navigation.
  useEffect(() => {
    if (!ready) return;
    const el = holder.current;
    if (!el) return;

    const themeObserver = new MutationObserver(render);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    let lastWidth = el.getBoundingClientRect().width;
    const sizeObserver = new ResizeObserver(() => {
      const next = el.getBoundingClientRect().width;
      if (Math.abs(next - lastWidth) < 8) return; // ignore sub-pixel churn
      lastWidth = next;
      render();
    });
    sizeObserver.observe(el);

    return () => {
      themeObserver.disconnect();
      sizeObserver.disconnect();
    };
  }, [ready, render]);

  return (
    <div>
      {/* Always laid out — never `hidden` — so its width can be measured. */}
      <div
        ref={holder}
        className={[
          "w-full [&>div]:!w-full [&_iframe]:!w-full",
          busy ? "pointer-events-none opacity-60" : "",
        ].join(" ")}
      />

      {!ready && (
        <div className="h-10 w-full rounded-md border border-border bg-card animate-pulse" />
      )}
      {busy && (
        <p className="mt-2 text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          {stage === "calendar" ? "Connecting your calendar…" : "Signing you in…"}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-[hsl(var(--destructive))]">{error}</p>
      )}
    </div>
  );
}
