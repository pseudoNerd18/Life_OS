"use client";

import { useCallback, useRef } from "react";
import { loadGsi } from "@/lib/auth/gsi-loader";

/**
 * Request calendar access from the browser, with no client secret involved.
 *
 * GIS's token client runs the implicit flow: the user consents in a popup and
 * Google hands back an access token directly. That is the whole reason this
 * works without a secret — and also the whole limitation, because Google only
 * issues *refresh* tokens to the authorization-code flow. The token lasts about
 * an hour and cannot be renewed silently.
 *
 * Returns a discriminated result rather than just a token: "the user said no"
 * and "Google refused this account" need different words on screen, and the
 * most common refusal — an app still in Testing mode, where sensitive scopes
 * are limited to approved testers — is otherwise indistinguishable from a
 * cancelled popup.
 */
export const CALENDAR_GRANT_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  // Google Tasks is a separate API from Calendar Events — without this, a
  // Task-linked item stays read-only (see google-tasks.ts).
  "https://www.googleapis.com/auth/tasks",
].join(" ");

export type CalendarGrant =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "cancelled" | "not-a-tester" | "blocked" | "unavailable"; detail?: string };

/** Google's refusal codes, mapped to something a person can act on. */
function classify(code: string | undefined, detail: string | undefined): CalendarGrant {
  const text = `${code ?? ""} ${detail ?? ""}`.toLowerCase();
  // "access_denied" covers both a declined consent screen and an app in Testing
  // mode rejecting a non-tester; the description is what separates them.
  if (/verification|tester|not completed/.test(text)) {
    return { ok: false, reason: "not-a-tester", detail };
  }
  if (/popup_failed_to_open|popup_blocked/.test(text)) {
    return { ok: false, reason: "blocked", detail };
  }
  if (/access_denied|popup_closed|user_cancel|abort/.test(text)) {
    return { ok: false, reason: "cancelled", detail };
  }
  return { ok: false, reason: "unavailable", detail: detail ?? code };
}

/** Exposed for tests: the mapping is the part worth pinning down. */
export const __classifyForTest = classify;

export function useGoogleCalendarGrant(clientId: string | null) {
  // GIS throws if a token client is constructed more than once per config, so
  // it is built lazily and reused.
  const client = useRef<GsiTokenClient | null>(null);

  const request = useCallback(async (): Promise<CalendarGrant> => {
    if (!clientId) {
      return { ok: false, reason: "unavailable", detail: "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set" };
    }
    // Load on demand: this hook is used on pages that don't render the sign-in
    // button, so it cannot assume the script is already there.
    if (!(await loadGsi())) {
      return { ok: false, reason: "unavailable", detail: "Google's sign-in script could not load" };
    }
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      return { ok: false, reason: "unavailable", detail: "Google's token client is unavailable" };
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: CalendarGrant) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      client.current = oauth2.initTokenClient({
        client_id: clientId,
        scope: CALENDAR_GRANT_SCOPES,
        callback: (res) => {
          // A partial grant (identity kept, calendar unticked) comes back
          // without our scope rather than as an error.
          if (res.error || !res.access_token) {
            return finish(classify(res.error, res.error_description));
          }
          finish({ ok: true, accessToken: res.access_token });
        },
        // Fires when the popup can't open or is closed without a decision;
        // without it the promise would hang forever.
        error_callback: (err) => finish(classify(err?.type, err?.message)),
      });

      client.current.requestAccessToken();
    });
  }, [clientId]);

  return request;
}
