/**
 * Google Tasks API client.
 *
 * Mirrors `google.ts`'s shape (plain `fetch`, no `googleapis` package) but
 * talks to a different service — Google Tasks (tasks.googleapis.com) is not
 * part of Calendar Events, which is why a Task-linked `CalendarEvent` needs
 * its own transport instead of `patchEvent`/`deleteEvent`.
 *
 * This module is pure transport — persistence and orchestration live in
 * `sync.ts`, same as `google.ts`.
 */

const API_BASE = process.env.GOOGLE_API_BASE?.replace(/\/$/, "") ?? null;
const TASKS_API = API_BASE ? `${API_BASE}/tasks/v1` : "https://tasks.googleapis.com/tasks/v1";

/** A Google task list. */
export interface GoogleTaskList {
  id: string;
  title: string;
}

/** A Google Task, narrowed to the fields we actually persist. */
export interface GoogleTask {
  id: string;
  title?: string;
  notes?: string;
  status?: "needsAction" | "completed";
  /** RFC 3339, but Google discards the time-of-day when a due date is set. */
  due?: string;
  updated?: string;
  deleted?: boolean;
  hidden?: boolean;
}

async function tasksRequest(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(`${TASKS_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { message?: string } }).error;
    // Same "→ {status}" format as google.ts's calRequest — sync.ts regex-
    // matches this substring to detect an already-gone remote row.
    throw new Error(`Google Tasks ${init.method ?? "GET"} ${path} → ${res.status}: ${err?.message ?? "unknown"}`);
  }
  return json as Record<string, unknown>;
}

/** All of a user's task lists, followed to the end of pagination. */
export async function listTaskLists(accessToken: string): Promise<GoogleTaskList[]> {
  const lists: GoogleTaskList[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({ maxResults: "100" });
    if (pageToken) p.set("pageToken", pageToken);
    const j = await tasksRequest(accessToken, `/users/@me/lists?${p}`);
    lists.push(...((j.items as GoogleTaskList[]) ?? []));
    pageToken = j.nextPageToken as string | undefined;
  } while (pageToken);
  return lists;
}

/**
 * Tasks in one list, followed to the end of pagination.
 *
 * Always asks for completed/deleted/hidden tasks — a completion or a remote
 * delete needs to be visible to reconcile, same reason Calendar's pull asks
 * for cancelled events instead of only live ones.
 */
export async function listTasks(
  accessToken: string,
  tasklistId: string,
  opts: { updatedMin?: Date } = {},
): Promise<GoogleTask[]> {
  const tasks: GoogleTask[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({
      maxResults: "100",
      showCompleted: "true",
      showDeleted: "true",
      showHidden: "true",
    });
    if (opts.updatedMin) p.set("updatedMin", opts.updatedMin.toISOString());
    if (pageToken) p.set("pageToken", pageToken);
    const j = await tasksRequest(accessToken, `/lists/${encodeURIComponent(tasklistId)}/tasks?${p}`);
    tasks.push(...((j.items as GoogleTask[]) ?? []));
    pageToken = j.nextPageToken as string | undefined;
  } while (pageToken);
  return tasks;
}

export function patchTask(
  accessToken: string,
  tasklistId: string,
  taskId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return tasksRequest(
    accessToken,
    `/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

/** Returns false when the task was already gone, which we treat as success. */
export async function deleteTask(
  accessToken: string,
  tasklistId: string,
  taskId: string,
): Promise<boolean> {
  try {
    await tasksRequest(
      accessToken,
      `/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
      { method: "DELETE" },
    );
    return true;
  } catch (err) {
    if (/→ 404|→ 410/.test((err as Error).message)) return false;
    throw err;
  }
}
