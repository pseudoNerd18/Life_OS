import { create } from "zustand";
import type { CalendarEvent } from "@prisma/client";

/**
 * CalendarEvent store with optimistic updates — same shape as `useTasks`
 * (src/stores/tasks.ts), including the `inFlight`/`mutationGen` race guard
 * against a background poll landing mid-mutation.
 */
interface CalendarEventsState {
  events: CalendarEvent[];
  loading: boolean;
  inFlight: number;
  mutationGen: number;

  load: (query?: string) => Promise<void>;
  add: (input: Partial<CalendarEvent> & { title: string; startAt: Date | string; endAt: Date | string }) => Promise<CalendarEvent | null>;
  update: (id: string, patch: Partial<CalendarEvent>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useCalendarEvents = create<CalendarEventsState>((set, get) => ({
  events: [],
  loading: false,
  inFlight: 0,
  mutationGen: 0,

  async load(query?: string) {
    const genBefore = get().mutationGen;
    set({ loading: true });
    let data: CalendarEvent[] = [];
    try {
      const res = await fetch(query ? `/api/calendar/events?${query}` : "/api/calendar/events");
      data = res.ok ? ((await res.json()) as CalendarEvent[]) : [];
    } catch {
      set({ loading: false });
      return;
    }
    const s = get();
    if (s.inFlight > 0 || s.mutationGen !== genBefore) {
      set({ loading: false });
      return;
    }
    set({ events: data, loading: false });
  },

  async add(input) {
    set((s) => ({ inFlight: s.inFlight + 1, mutationGen: s.mutationGen + 1 }));
    try {
      const res = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const e = (await res.json()) as CalendarEvent;
      set((s) => ({ events: [e, ...s.events] }));
      return e;
    } catch {
      return null;
    } finally {
      set((s) => ({ inFlight: Math.max(0, s.inFlight - 1), mutationGen: s.mutationGen + 1 }));
    }
  },

  async update(id, patch) {
    const prev = get().events;
    set((s) => ({
      events: prev.map((e) => (e.id === id ? ({ ...e, ...patch } as CalendarEvent) : e)),
      inFlight: s.inFlight + 1,
      mutationGen: s.mutationGen + 1,
    }));
    try {
      const res = await fetch(`/api/calendar/events/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        set((s) => ({
          events: s.events.map((e) => {
            if (e.id !== id) return e;
            const original = prev.find((p) => p.id === id);
            return original ?? e;
          }),
        }));
      }
    } catch {
      set((s) => ({
        events: s.events.map((e) => {
          if (e.id !== id) return e;
          const original = prev.find((p) => p.id === id);
          return original ?? e;
        }),
      }));
    } finally {
      set((s) => ({ inFlight: Math.max(0, s.inFlight - 1), mutationGen: s.mutationGen + 1 }));
    }
  },

  async remove(id) {
    const prev = get().events;
    set((s) => ({
      events: prev.filter((e) => e.id !== id),
      inFlight: s.inFlight + 1,
      mutationGen: s.mutationGen + 1,
    }));
    try {
      const res = await fetch(`/api/calendar/events/${id}`, { method: "DELETE" });
      // A 404 means the row is already gone — that's the goal state for a
      // delete, not a failure. Reverting here would resurrect an item the
      // user (or a duplicate in-flight request) already removed.
      if (!res.ok && res.status !== 404) {
        set((s) => {
          const removed = prev.find((p) => p.id === id);
          if (!removed) return s;
          if (s.events.some((e) => e.id === id)) return s;
          return { events: [removed, ...s.events] };
        });
      }
    } catch {
      set((s) => {
        const removed = prev.find((p) => p.id === id);
        if (!removed || s.events.some((e) => e.id === id)) return s;
        return { events: [removed, ...s.events] };
      });
    } finally {
      set((s) => ({ inFlight: Math.max(0, s.inFlight - 1), mutationGen: s.mutationGen + 1 }));
    }
  },
}));

/**
 * Replace the list wholesale with server-rendered rows. Module-level so its
 * identity is stable across renders — see lib/use-adopted-rows.ts.
 */
export const adoptCalendarEvents = (events: CalendarEvent[]) =>
  useCalendarEvents.setState({ events });
