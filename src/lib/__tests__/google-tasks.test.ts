import { describe, test, expect, vi, afterEach } from "vitest";
import { deleteTask, listTaskLists, listTasks, patchTask } from "../calendar/google-tasks";

/**
 * The Tasks client is pure transport, so these pin the two things the rest of
 * the sync engine actually depends on: pagination being followed to the end,
 * and the error-string format (`→ {status}`) that `sync.ts` and `deleteTask`
 * regex-match to recognise an already-gone remote row.
 */

function jsonOnce(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("google-tasks · listTaskLists()", () => {
  test("follows pagination and concatenates pages", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(jsonOnce({ items: [{ id: "a", title: "A" }], nextPageToken: "p2" }))
      .mockReturnValueOnce(jsonOnce({ items: [{ id: "b", title: "B" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const lists = await listTaskLists("tok");
    expect(lists.map((l) => l.id)).toEqual(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("pageToken=p2");
  });

  test("sends the bearer token", async () => {
    const fetchMock = vi.fn().mockReturnValue(jsonOnce({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await listTaskLists("secret-token");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-token");
  });
});

describe("google-tasks · listTasks()", () => {
  test("asks for completed, deleted and hidden tasks", async () => {
    const fetchMock = vi.fn().mockReturnValue(jsonOnce({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await listTasks("tok", "list-1");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("showCompleted=true");
    expect(url).toContain("showDeleted=true");
    expect(url).toContain("showHidden=true");
    // A remote delete or completion is invisible without these, so a task
    // removed in Google would never be reconciled.
  });

  test("passes updatedMin when given, and omits it when not", async () => {
    const fetchMock = vi.fn().mockReturnValue(jsonOnce({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const since = new Date("2026-03-01T10:00:00Z");
    await listTasks("tok", "list-1", { updatedMin: since });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      `updatedMin=${encodeURIComponent(since.toISOString())}`,
    );

    fetchMock.mockClear();
    await listTasks("tok", "list-1");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("updatedMin");
  });

  test("encodes the task list id into the path", async () => {
    const fetchMock = vi.fn().mockReturnValue(jsonOnce({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await listTasks("tok", "a/b?c");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/lists/a%2Fb%3Fc/tasks");
  });
});

describe("google-tasks · error format", () => {
  test("failures carry the `→ {status}` marker sync.ts matches on", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(jsonOnce({ error: { message: "nope" } }, 403)));
    await expect(patchTask("tok", "l", "t", {})).rejects.toThrow(/→ 403/);
  });
});

describe("google-tasks · deleteTask()", () => {
  test("an already-deleted task counts as success, not an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(jsonOnce({ error: { message: "gone" } }, 404)));
    await expect(deleteTask("tok", "l", "t")).resolves.toBe(false);
  });

  test("a real failure still propagates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(jsonOnce({ error: { message: "boom" } }, 500)));
    await expect(deleteTask("tok", "l", "t")).rejects.toThrow(/→ 500/);
  });

  test("a 204 delete resolves true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(jsonOnce(null, 204)));
    await expect(deleteTask("tok", "l", "t")).resolves.toBe(true);
  });
});
