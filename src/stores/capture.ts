import { create } from "zustand";

/**
 * Capture activity log — the inline replacement for toast notifications.
 *
 * A toast says something happened and then destroys the evidence. Quick Capture
 * is the one surface where you fire off a request in natural language and the
 * *interpretation* is the whole product: whether "next Friday at 4" landed on
 * the right day, whether a goal was read as a goal. That deserves a record you
 * can look back at, not a three-second popup.
 *
 * Entries are kept newest-first and persisted to localStorage so the log
 * survives a refresh. It is per-browser and best-effort: a private window or
 * blocked site data just means an empty log, never a crash.
 */

export type CaptureStatus = "processing" | "done" | "error";
export type CaptureSource = "text" | "voice";

export interface CaptureEntry {
  id: string;
  /** What was actually sent to the assistant. */
  text: string;
  source: CaptureSource;
  status: CaptureStatus;
  /** The assistant's natural-language reply, once it arrives. */
  reply?: string;
  /** Intent the router settled on, e.g. CREATE_TASK. */
  intent?: string;
  /** What the request actually wrote, for the detail popover. */
  created?: { tasks: number; goal: boolean; note: boolean };
  error?: string;
  /** Present when this turn deleted something; lets the row offer an undo. */
  undo?: { kind: "task" | "note" | "goal"; title: string; data: Record<string, unknown> };
  /** Set once the undo has been used, so it can't be replayed. */
  undone?: boolean;
  /** A session event rather than a request — rendered without a request line. */
  info?: boolean;
  requestedAt: number;
  respondedAt?: number;
}

const STORAGE_KEY = "lifeos.capture.log.v1";
const MAX_ENTRIES = 50;

function load(): CaptureEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as CaptureEntry[])
      // A request that was in flight when the tab closed can never resolve.
      .map((e) => (e.status === "processing"
        ? { ...e, status: "error" as const, error: "Interrupted — the page was closed before a reply arrived." }
        : e))
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function save(entries: CaptureEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Quota, private mode, or blocked site data — the log is a convenience.
  }
}

interface CaptureState {
  entries: CaptureEntry[];
  /** localStorage is read on mount, never during render — see hydrate(). */
  hydrated: boolean;
  hydrate: () => void;
  /** Register a new request and return its id. */
  begin: (text: string, source: CaptureSource) => string;
  resolve: (id: string, patch: Omit<Partial<CaptureEntry>, "id">) => void;
  /** Record something that failed before it ever became a request. */
  fail: (text: string, source: CaptureSource, error: string) => void;
  /** Record a session event that isn't a request (e.g. voice mode ending). */
  note: (message: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

let seq = 0;
function nextId() {
  // Deliberately not Math.random(): a monotonic counter plus the timestamp is
  // unique enough here and keeps ids sortable.
  seq += 1;
  return `cap-${Date.now().toString(36)}-${seq}`;
}

export const useCapture = create<CaptureState>((set, get) => ({
  entries: [],
  hydrated: false,

  hydrate() {
    if (get().hydrated) return;
    set({ entries: load(), hydrated: true });
  },

  begin(text, source) {
    const entry: CaptureEntry = {
      id: nextId(),
      text,
      source,
      status: "processing",
      requestedAt: Date.now(),
    };
    set((s) => {
      const entries = [entry, ...s.entries].slice(0, MAX_ENTRIES);
      save(entries);
      return { entries };
    });
    return entry.id;
  },

  resolve(id, patch) {
    set((s) => {
      const entries = s.entries.map((e) =>
        e.id === id ? { ...e, respondedAt: Date.now(), ...patch } : e,
      );
      save(entries);
      return { entries };
    });
  },

  fail(text, source, error) {
    const now = Date.now();
    set((s) => {
      const entries = [
        {
          id: nextId(),
          text,
          source,
          status: "error" as const,
          error,
          requestedAt: now,
          respondedAt: now,
        },
        ...s.entries,
      ].slice(0, MAX_ENTRIES);
      save(entries);
      return { entries };
    });
  },

  note(message) {
    const now = Date.now();
    set((s) => {
      const entries = [
        {
          id: nextId(),
          text: message,
          source: "voice" as const,
          status: "done" as const,
          reply: message,
          requestedAt: now,
          respondedAt: now,
          info: true,
        },
        ...s.entries,
      ].slice(0, MAX_ENTRIES);
      save(entries);
      return { entries };
    });
  },

  remove(id) {
    set((s) => {
      const entries = s.entries.filter((e) => e.id !== id);
      save(entries);
      return { entries };
    });
  },

  clear() {
    save([]);
    set({ entries: [] });
  },
}));
