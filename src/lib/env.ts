/**
 * Environment + capability detection.
 *
 * The app is local-first and must boot even when nothing is configured.
 * This module answers one question for the rest of the codebase:
 *   "What can we actually do right now?"
 *
 * It never throws. It returns a capability report.
 */

export interface Capabilities {
  /** A real Postgres URL is present and well-formed. */
  hasDatabase: boolean;
  /** Ollama host is configured (we don't ping it here — that's a health check). */
  hasOllama: boolean;
  /** Whisper endpoint is configured. */
  hasWhisper: boolean;
  /**
   * The public Google client ID is present, so Google sign-in works and a
   * calendar can be connected for a session. Not a secret — see
   * `lib/auth/google-id-token.ts`.
   */
  hasGoogleSignIn: boolean;
  /**
   * A Google client *secret* is present as well, which is the only way to obtain
   * a refresh token — so this gates lasting, background calendar sync, not
   * calendar access as such.
   */
  hasGoogleCalendar: boolean;
  /**
   * Twilio is fully configured (SID, token and a from-number), so the app can
   * ring your phone before a calendar event. Missing any one of the three
   * disables reminder calls without affecting anything else.
   */
  hasTwilio: boolean;
  /** True when we're falling back to in-memory storage. */
  memoryMode: boolean;
  /** Human-readable notes for the diagnostics screen. */
  notes: string[];
}

function looksLikePostgresUrl(v: string | undefined): boolean {
  if (!v) return false;
  return /^postgres(ql)?:\/\/.+/.test(v.trim());
}

let cached: Capabilities | null = null;

export function getCapabilities(): Capabilities {
  if (cached) return cached;

  const notes: string[] = [];
  const hasDatabase = looksLikePostgresUrl(process.env.DATABASE_URL);
  const hasOllama = !!process.env.OLLAMA_HOST;
  const hasWhisper = !!process.env.WHISPER_SERVER_URL;
  const hasGoogleSignIn = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  const hasGoogleCalendar =
    !!process.env.GOOGLE_CLIENT_ID?.trim() && !!process.env.GOOGLE_CLIENT_SECRET?.trim();
  const hasTwilio =
    !!process.env.TWILIO_ACCOUNT_SID?.trim() &&
    !!process.env.TWILIO_AUTH_TOKEN?.trim() &&
    !!process.env.TWILIO_FROM_NUMBER?.trim();

  if (!hasDatabase) {
    notes.push(
      "DATABASE_URL is missing or malformed — running in in-memory mode. " +
      "Data will not persist across restarts. Set DATABASE_URL and run `npx prisma db push` to enable persistence.",
    );
  }
  if (!hasOllama) {
    notes.push("OLLAMA_HOST not set — AI extraction will use a deterministic local fallback parser.");
  }
  if (!hasWhisper) {
    notes.push("WHISPER_SERVER_URL not set — voice capture will be disabled until configured.");
  }
  // Only the absence of the public client ID is an actual problem: with just
  // that, sign-in and session-length calendar sync both work. A missing client
  // *secret* only shortens how long a connection lasts, which the calendar UI
  // already says per-account ("connected for this session") — so it is not
  // worth a global banner.
  if (!hasGoogleSignIn) {
    notes.push(
      "NEXT_PUBLIC_GOOGLE_CLIENT_ID not set — Google sign-in and Google Calendar are unavailable. " +
      "It is a public value, not a secret; see .env.example. Email/password sign-in still works.",
    );
  }

  // No global note for a missing Twilio config: reminder calls are opt-in, and
  // the card on the Today page says so in the one place it matters.

  cached = {
    hasDatabase,
    hasOllama,
    hasWhisper,
    hasGoogleSignIn,
    hasGoogleCalendar,
    hasTwilio,
    memoryMode: !hasDatabase,
    notes,
  };
  return cached;
}

/** Test hook — clears the memoized report. */
export function _resetCapabilities() {
  cached = null;
}
