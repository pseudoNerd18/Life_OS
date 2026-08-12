/**
 * A stand-in Google Calendar, good enough to exercise the sync engine.
 *
 * Implements only what `lib/calendar/google.ts` calls, but implements the parts
 * that actually shape our logic faithfully: incremental `syncToken` deltas,
 * pagination, `410 GONE` on a stale token, `cancelled` tombstones, and
 * `extendedProperties.private` round-tripping.
 */
import { createServer, type Server } from "node:http";

export interface MockEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string }[];
  recurrence?: string[];
  updated?: string;
  extendedProperties?: { private?: Record<string, string> };
}

export interface MockGoogle {
  url: string;
  close: () => Promise<void>;
  /** Everything the mock currently holds, by event id. */
  events: Map<string, MockEvent>;
  /** Calls received, for asserting on what the engine actually sent. */
  calls: { method: string; path: string; body?: unknown }[];
  /** Force the next list request to reject the caller's syncToken with a 410. */
  expireSyncToken: () => void;
  /** Seed or overwrite an event as though it came from Google. */
  put: (e: MockEvent) => void;
  /** How many pages to split a full list into, to exercise pagination. */
  pageSize: number;
  /** Set to make the token endpoint issue a new access token. */
  refreshedAccessToken: string;
}

export async function startMockGoogle(seed: MockEvent[] = []): Promise<MockGoogle> {
  const events = new Map<string, MockEvent>();
  // `updated` is stamped after the spread on purpose: a caller doing
  // `put({ ...existing, summary: "x" })` carries a stale `updated` in the
  // spread, and letting that win would make a fresh edit look older than it is.
  for (const e of seed) events.set(e.id, { ...e, updated: new Date().toISOString() });

  const state: MockGoogle = {
    url: "",
    close: async () => {},
    events,
    calls: [],
    expireSyncToken: () => { expireNext = true; },
    put: (e) => {
      events.set(e.id, { ...e, updated: new Date().toISOString() });
      touch(e.id);
    },
    pageSize: 250,
    refreshedAccessToken: "refreshed-access-token",
  };

  let expireNext = false;
  let counter = 0;
  // Google's incremental sync returns everything CHANGED since the token was
  // issued — including tombstones for events it had already delivered. So the
  // delta has to key off change time, not "have I sent this id before":
  // each event carries a version, and a token records the watermark at issue.
  let version = 0;
  const eventVersion = new Map<string, number>();
  const tokenWatermark = new Map<string, number>();
  const touch = (id: string) => eventVersion.set(id, ++version);
  for (const e of events.keys()) touch(e);

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      // OAuth endpoints are form-encoded; the Calendar API is JSON.
      const isJson = (req.headers["content-type"] ?? "").includes("json");
      let body: unknown;
      if (raw) {
        try {
          body = isJson ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
        } catch {
          body = raw;
        }
      }
      state.calls.push({ method: req.method ?? "GET", path: url.pathname, body });
      const send = (code: number, obj: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };

      // ── OAuth ──
      if (url.pathname === "/token") {
        return send(200, {
          access_token: state.refreshedAccessToken,
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar.events",
        });
      }
      if (url.pathname === "/revoke") return send(200, {});
      if (url.pathname === "/oauth2/v3/userinfo") return send(200, { email: "test@example.com" });

      const m = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/(.+))?$/);
      if (!m) return send(404, { error: { message: "no such route" } });
      const eventId = m[2] ? decodeURIComponent(m[2]) : null;

      // ── List ──
      if (req.method === "GET" && !eventId) {
        const syncToken = url.searchParams.get("syncToken");
        if (syncToken && expireNext) {
          expireNext = false;
          return send(410, { error: { message: "Sync token is no longer valid" } });
        }

        const all = [...events.values()];
        const watermark = syncToken ? tokenWatermark.get(syncToken) ?? 0 : 0;
        const delta = syncToken
          ? all.filter((e) => (eventVersion.get(e.id) ?? 0) > watermark)
          : all;

        const pageToken = url.searchParams.get("pageToken");
        const offset = pageToken ? Number(pageToken) : 0;
        const page = delta.slice(offset, offset + state.pageSize);
        const nextOffset = offset + state.pageSize;
        const hasMore = nextOffset < delta.length;

        if (hasMore) {
          return send(200, { items: page, nextPageToken: String(nextOffset) });
        }
        // Last page carries the new cursor, exactly as Google does.
        const newToken = `sync-${++counter}`;
        tokenWatermark.set(newToken, version);
        return send(200, { items: page, nextSyncToken: newToken });
      }

      // ── Insert ──
      if (req.method === "POST" && !eventId) {
        const id = `gcal-created-${++counter}`;
        // Spread the body first: the server assigns the id and updated stamp,
        // so a caller-supplied `id` must not win. The other order let the client
        // choose its own event id, which real Google never allows.
        const created: MockEvent = { ...(body as MockEvent), id, updated: new Date().toISOString() };
        events.set(id, created);
        touch(id);
        return send(200, created);
      }

      // ── Patch ──
      if (req.method === "PATCH" && eventId) {
        const existing = events.get(eventId);
        if (!existing) return send(404, { error: { message: "Not Found" } });
        const merged = { ...existing, ...(body as MockEvent), updated: new Date().toISOString() };
        events.set(eventId, merged);
        touch(eventId);
        return send(200, merged);
      }

      // ── Delete ──
      if (req.method === "DELETE" && eventId) {
        if (!events.has(eventId)) return send(404, { error: { message: "Not Found" } });
        events.delete(eventId);
        res.writeHead(204);
        return res.end();
      }

      return send(405, { error: { message: "method not allowed" } });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("mock server did not bind");
  state.url = `http://127.0.0.1:${addr.port}`;
  state.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return state;
}
