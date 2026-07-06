import { create } from "zustand";
import type { Task } from "@prisma/client";

/**
 * Task store with optimistic updates.
 *
 * Desync fix: a background poll (`load()` on a 30s interval) used to be able to
 * land in the middle of an optimistic mutation and overwrite the local state
 * with stale server data — the task would visibly "snap back".
 *
 * Now an `inFlight` counter tracks active mutations. `load()` refuses to apply
 * its result whenever `inFlight > 0`, OR whenever a mutation started/finished
 * while the fetch was in transit (tracked via a generation stamp). The user's
 * intent always wins over a background refresh.
 */
interface TasksState {
  tasks: Task[];
  loading: boolean;
  /** Number of mutations currently awaiting their server response. */
  inFlight: number;
  /** Bumped on every mutation start — lets load() detect races. */
  mutationGen: number;

  /**
   * Refresh from the server. `query` must match the filter the list was
   * server-rendered with (e.g. "scope=today"), otherwise the poll widens the
   * list behind the user's back.
   */
  load: (query?: string) => Promise<void>;
  add: (input: Partial<Task> & { title: string }) => Promise<Task | null>;
  update: (id: string, patch: Partial<Task>) => Promise<void>;
  toggleDone: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useTasks = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,
  inFlight: 0,
  mutationGen: 0,

  async load(query?: string) {
    // Snapshot the mutation generation before the fetch.
    const genBefore = get().mutationGen;
    set({ loading: true });
    let data: Task[] = [];
    try {
      const res = await fetch(query ? `/api/tasks?${query}` : "/api/tasks");
      data = res.ok ? ((await res.json()) as Task[]) : [];
    } catch {
      set({ loading: false });
      return;
    }
    const s = get();
    // Drop the result if: a mutation is in flight, OR any mutation
    // started/completed while we were fetching. The local state is fresher.
    if (s.inFlight > 0 || s.mutationGen !== genBefore) {
      set({ loading: false });
      return;
    }
    set({ tasks: data, loading: false });
  },

  async add(input) {
    set((s) => ({ inFlight: s.inFlight + 1, mutationGen: s.mutationGen + 1 }));
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const t = (await res.json()) as Task;
      set((s) => ({ tasks: [t, ...s.tasks] }));
      return t;
    } catch {
      return null;
    } finally {
      set((s) => ({ inFlight: Math.max(0, s.inFlight - 1), mutationGen: s.mutationGen + 1 }));
    }
  },

  async update(id, patch) {
    const prev = get().tasks;
    // optimistic
    set((s) => ({
      tasks: prev.map((t) => (t.id === id ? ({ ...t, ...patch } as Task) : t)),
      inFlight: s.inFlight + 1,
      mutationGen: s.mutationGen + 1,
    }));
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        // revert — but merge against current state, not the stale snapshot,
        // so we don't clobber a *different* task edited in the meantime.
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id) return t;
            const original = prev.find((p) => p.id === id);
            return original ?? t;
          }),
        }));
      }
    } catch {
      set((s) => ({
        tasks: s.tasks.map((t) => {
          if (t.id !== id) return t;
          const original = prev.find((p) => p.id === id);
          return original ?? t;
        }),
      }));
    } finally {
      set((s) => ({ inFlight: Math.max(0, s.inFlight - 1), mutationGen: s.mutationGen + 1 }));
    }
  },

  async toggleDone(id) {
    const t = get().tasks.find((x) => x.id === id);
    if (!t) return;
    const next = t.status === "DONE" ? "TODO" : "DONE";
    return get().update(id, {
      status: next,
      completedAt: next === "DONE" ? new Date() : null,
    });
  },

  async remove(id) {
    const prev = get().tasks;
    set((s) => ({
      tasks: prev.filter((t) => t.id !== id),
      inFlight: s.inFlight + 1,
      mutationGen: s.mutationGen + 1,
    }));
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      // A 404 means the row is already gone — that's the goal state for a
      // delete, not a failure. Reverting here would resurrect an item a
      // duplicate in-flight request already removed.
      if (!res.ok && res.status !== 404) {
        // restore the removed row without disturbing other concurrent edits
        set((s) => {
          const removed = prev.find((p) => p.id === id);
          if (!removed) return s;
          if (s.tasks.some((t) => t.id === id)) return s;
          return { tasks: [removed, ...s.tasks] };
        });
      }
    } catch {
      set((s) => {
        const removed = prev.find((p) => p.id === id);
        if (!removed || s.tasks.some((t) => t.id === id)) return s;
        return { tasks: [removed, ...s.tasks] };
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
export const adoptTasks = (tasks: Task[]) => useTasks.setState({ tasks });
