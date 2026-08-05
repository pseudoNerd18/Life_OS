"use client";
import { useEffect, useMemo, useState } from "react";

/**
 * Hand server-rendered rows to a client store, without writing to the store
 * during render.
 *
 * Two bugs meet here, and a fix for either one alone reintroduces the other.
 *
 *  1. Writing during render. `useTasks.setState(...)` in a render body updates
 *     every component subscribed to that store — including ones React is not
 *     currently rendering. The two calendar views share these stores, and
 *     during a fortnight↔month switch both are briefly mounted, so MonthView's
 *     render updated CalendarView mid-render: "Cannot update a component while
 *     rendering a different component".
 *
 *  2. Re-hydrating on every parent render. The obvious `useEffect(..., [rows])`
 *     re-runs whenever the prop's array *identity* changes, which is every
 *     server render — clobbering whatever the user had just done locally.
 *
 * So adoption is keyed on the rows' *content*: a re-render carrying the same
 * rows is ignored, while genuinely new rows (a different month, a
 * `router.refresh()` after a mutation) are adopted. Until the store has taken
 * a given set of rows over, they are rendered straight from the prop, which is
 * what keeps the first paint identical to the server's markup.
 */
export function useAdoptedRows<T extends { id: string; updatedAt: Date | string }>(
  rows: T[],
  live: T[],
  adopt: (rows: T[]) => void,
): T[] {
  const stamp = useMemo(() => signature(rows), [rows]);
  const [adopted, setAdopted] = useState<string | null>(null);

  useEffect(() => {
    if (adopted === stamp) return;
    adopt(rows);
    setAdopted(stamp);
  }, [adopted, stamp, rows, adopt]);

  return adopted === stamp ? live : rows;
}

/**
 * Identity of the rows themselves rather than of the array holding them.
 * `updatedAt` is in the stamp so a refresh that actually changed a row counts
 * as new content, not just a reordering.
 */
function signature(rows: Array<{ id: string; updatedAt: Date | string }>): string {
  return rows
    .map((r) => `${r.id}@${new Date(r.updatedAt).getTime()}`)
    .join("|");
}
