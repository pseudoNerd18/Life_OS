/**
 * Google Calendar API client.
 *
 * Deliberately dependency-free: the `googleapis` package is ~50MB and pulls in
 * a discovery layer we don't need for six endpoints. This is plain `fetch`
 * against the REST API, so it also runs unchanged on the edge if that's ever
 * wanted.
 *
 * This module is pure transport — it knows nothing about our database. All
 * persistence lives in `sync.ts`, and token refresh in `tokens.ts`.
 */

/**
 * Endpoint bases.
 *
 * `GOOGLE_API_BASE` exists so the sync engine can be pointed at a stand-in
 * Google during testing — the pull/push/conflict logic is the part worth
 * exercising, and it is unreachable behind real OAuth. Unset (the normal case)
 * every base is the real Google.
 */
const API_BASE = process.env.GOOGLE_API_BASE?.replace(/\/$/, "") ?? null;

const OAUTH_AUTH = API_BASE
  ? `${API_BASE}/o/oauth2/v2/auth`
  : "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = API_BASE ? `${API_BASE}/token` : "https://oauth2.googleapis.com/token";
const OAUTH_REVOKE = API_BASE ? `${API_BASE}/revoke` : "https://oauth2.googleapis.com/revoke";
const CAL_API = API_BASE ? `${API_BASE}/calendar/v3` : "https://www.googleapis.com/calendar/v3";
const USERINFO = API_BASE
  ? `${API_BASE}/oauth2/v3/userinfo`
  : "https://www.googleapis.com/oauth2/v3/userinfo";

/**
 * Two-way sync needs write access to events. We deliberately do NOT request
 * `calendar` (full account access) — `calendar.events` can create and modify
 * events but cannot delete or reconfigure the calendars themselves.
 */
/** The write scope; its presence is what tells us calendar access was granted. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/**
 * Google Tasks is a separate API from Calendar Events, so it needs its own
 * scope — a user can have calendar access without this, in which case
 * Task-linked calendar rows stay read-only until they reconnect.
 */
export const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

export const GOOGLE_SCOPES = [
  CALENDAR_SCOPE,
  "https://www.googleapis.com/auth/calendar.readonly",
  TASKS_SCOPE,
  "openid",
  "email",
];

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Returns null when Google isn't configured, rather than throwing — the app is
 * local-first and every other integration degrades the same way.
 */
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const base = (process.env.APP_URL || "http://localhost:3010").replace(/\/$/, "");
  return { clientId, clientSecret, redirectUri: `${base}/api/calendar/google/callback` };
}

export function authUrl(cfg: GoogleConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    state,
    // `offline` is what gets us a refresh_token at all; `consent` forces Google
    // to re-issue one even if the user has authorized this client before —
    // without it, a reconnect returns no refresh_token and sync dies silently
    // an hour later.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${OAUTH_AUTH}?${p.toString()}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
}

function toTokenSet(j: Record<string, unknown>): TokenSet {
  const expiresIn = typeof j.expires_in === "number" ? j.expires_in : 3600;
  return {
    accessToken: String(j.access_token),
    refreshToken: j.refresh_token ? String(j.refresh_token) : null,
    // 60s of slack so we refresh just before expiry rather than just after.
    expiresAt: new Date(Date.now() + (expiresIn - 60) * 1000),
    scope: typeof j.scope === "string" ? j.scope : GOOGLE_SCOPES.join(" "),
  };
}

async function tokenRequest(body: URLSearchParams): Promise<TokenSet> {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const j = json as Record<string, unknown>;
    throw new Error(
      `Google token request failed (${res.status}): ${j.error_description ?? j.error ?? "unknown"}`,
    );
  }
  return toTokenSet(json as Record<string, unknown>);
}

export function exchangeCode(cfg: GoogleConfig, code: string): Promise<TokenSet> {
  return tokenRequest(new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  }));
}

export function refreshAccessToken(cfg: GoogleConfig, refreshToken: string): Promise<TokenSet> {
  return tokenRequest(new URLSearchParams({
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
  }));
}

/** Best-effort: revoking is courtesy, so a failure here must not block disconnect. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(OAUTH_REVOKE, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return "unknown";
  const j = (await res.json().catch(() => ({}))) as { email?: string };
  return j.email ?? "unknown";
}

// ── Events ────────────────────────────────────────────────────

/** A Google event, narrowed to the fields we actually persist. */
export interface GoogleEvent {
  id: string;
  status?: string; // "cancelled" for deletions in an incremental page
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email?: string }[];
  recurrence?: string[];
  updated?: string;
  extendedProperties?: { private?: Record<string, string> };
}

/** Thrown when Google invalidates a sync token; the caller must do a full resync. */
export class SyncTokenExpired extends Error {
  constructor() {
    super("Google sync token expired (410) — a full resync is required");
    this.name = "SyncTokenExpired";
  }
}

async function calRequest(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(`${CAL_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  // 410 GONE means our stored syncToken is too old — a documented, expected
  // condition, not an error state. The caller drops the token and starts over.
  if (res.status === 410) throw new SyncTokenExpired();
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { message?: string } }).error;
    throw new Error(`Google Calendar ${init.method ?? "GET"} ${path} → ${res.status}: ${err?.message ?? "unknown"}`);
  }
  return json as Record<string, unknown>;
}

export interface ListResult {
  events: GoogleEvent[];
  nextSyncToken: string | null;
}

/**
 * List events, following pagination to the end.
 *
 * With `syncToken` this returns only what changed since that token (including
 * cancellations). Without one it does a windowed full read — bounded, because
 * an unbounded read of a calendar with years of history is both slow and
 * useless to us.
 */
export async function listEvents(
  accessToken: string,
  opts: { calendarId?: string; syncToken?: string | null; timeMin?: Date; timeMax?: Date },
): Promise<ListResult> {
  const calendarId = encodeURIComponent(opts.calendarId || "primary");
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  do {
    const p = new URLSearchParams({ maxResults: "250", singleEvents: "true" });
    if (opts.syncToken) {
      // Google rejects a request that mixes syncToken with time filters.
      p.set("syncToken", opts.syncToken);
    } else {
      if (opts.timeMin) p.set("timeMin", opts.timeMin.toISOString());
      if (opts.timeMax) p.set("timeMax", opts.timeMax.toISOString());
      p.set("orderBy", "startTime");
    }
    if (pageToken) p.set("pageToken", pageToken);

    const j = await calRequest(accessToken, `/calendars/${calendarId}/events?${p}`);
    events.push(...((j.items as GoogleEvent[]) ?? []));
    pageToken = j.nextPageToken as string | undefined;
    nextSyncToken = (j.nextSyncToken as string | undefined) ?? nextSyncToken;
  } while (pageToken);

  return { events, nextSyncToken };
}

export function insertEvent(
  accessToken: string,
  calendarId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return calRequest(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return calRequest(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

/** Returns false when the event was already gone, which we treat as success. */
export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<boolean> {
  try {
    await calRequest(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
    return true;
  } catch (err) {
    if (/→ 404|→ 410/.test((err as Error).message)) return false;
    throw err;
  }
}

// ── Browser-granted session tokens ────────────────────────────

export interface TokenInfo {
  /** The client the token was issued to. MUST equal ours. */
  audience: string;
  email: string | null;
  scopes: string[];
  expiresInSec: number;
}

/**
 * Ask Google what an access token actually is.
 *
 * An access token is opaque — unlike an ID token there is nothing to verify
 * locally, so its properties have to come from Google. This is also the only
 * defence against token substitution: a token minted for a *different* client
 * would otherwise be accepted as if it were ours, so `audience` must be
 * checked by the caller.
 */
export async function inspectAccessToken(accessToken: string): Promise<TokenInfo> {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`Google rejected the access token (${res.status})`);
  const j = (await res.json()) as Record<string, unknown>;

  const audience = typeof j.aud === "string" ? j.aud : "";
  if (!audience) throw new Error("token info carries no audience");

  return {
    audience,
    email: typeof j.email === "string" ? j.email.toLowerCase() : null,
    scopes: typeof j.scope === "string" ? j.scope.split(/\s+/).filter(Boolean) : [],
    expiresInSec: Number(j.expires_in) || 0,
  };
}
