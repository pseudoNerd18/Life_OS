import { describe, test, expect, beforeAll } from "vitest";

// The store persists through localStorage, which doesn't exist in node.
// A minimal shim lets the real store run unmodified — including its
// JSON round-trip, which is where a persistence bug would actually live.
const mem = new Map<string, string>();

beforeAll(() => {
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
});

describe("capture activity log", async () => {
  // Imported after the shim is in place, since the module reads it on demand.
  const { useCapture } = await import("../../stores/capture");
  const store = () => useCapture.getState();

  test("begin() records a processing entry, newest first", () => {
    store().clear();
    store().begin("first request", "text");
    const id2 = store().begin("second request", "voice");
    const es = store().entries;
    expect(es.length).toBe(2);
    expect(es[0].id).toBe(id2);
    expect(es[0].text).toBe("second request");
    expect(es[0].source).toBe("voice");
    expect(es[0].status).toBe("processing");
    expect(es[0].requestedAt > 0).toBeTruthy();
    expect(es[0].respondedAt).toBe(undefined);
  });

  test("resolve() attaches the reply and a response time", () => {
    store().clear();
    const id = store().begin("add milk", "text");
    store().resolve(id, {
      status: "done",
      reply: 'Added "Buy milk".',
      intent: "CREATE_TASK",
      created: { tasks: 1, goal: false, note: false },
    });
    const e = store().entries[0];
    expect(e.status).toBe("done");
    expect(e.reply).toBe('Added "Buy milk".');
    expect(e.intent).toBe("CREATE_TASK");
    expect(e.created?.tasks).toBe(1);
    expect(e.respondedAt && e.respondedAt >= e.requestedAt).toBeTruthy();
  });

  test("resolve() on an unknown id is a no-op, not a crash", () => {
    store().clear();
    store().begin("something", "text");
    store().resolve("nope", { status: "done" });
    expect(store().entries[0].status).toBe("processing");
  });

  test("fail() records an errored entry without a prior begin()", () => {
    store().clear();
    store().fail("(dictation)", "voice", "Transcription failed.");
    const e = store().entries[0];
    expect(e.status).toBe("error");
    expect(e.error).toBe("Transcription failed.");
    expect(e.respondedAt).toBeTruthy();
  });

  test("ids are unique across rapid successive calls", () => {
    store().clear();
    const ids = new Set(Array.from({ length: 50 }, (_, i) => store().begin(`req ${i}`, "text")));
    expect(ids.size).toBe(50);
  });

  test("the log is capped so it can't grow without bound", () => {
    store().clear();
    for (let i = 0; i < 80; i++) store().begin(`req ${i}`, "text");
    expect(store().entries.length).toBe(50);
    expect(store().entries[0].text).toBe("req 79");
  });

  test("remove() drops one entry and leaves the rest", () => {
    store().clear();
    store().begin("keep me", "text");
    const doomed = store().begin("remove me", "text");
    store().remove(doomed);
    expect(store().entries.length).toBe(1);
    expect(store().entries[0].text).toBe("keep me");
  });

  test("entries survive a reload", () => {
    store().clear();
    const id = store().begin("persist me", "text");
    store().resolve(id, { status: "done", reply: "ok" });
    // Simulate a fresh page: reset in-memory state, then hydrate from storage.
    useCapture.setState({ entries: [], hydrated: false });
    store().hydrate();
    expect(store().entries.length).toBe(1);
    expect(store().entries[0].reply).toBe("ok");
  });

  test("a request interrupted by a reload is marked failed, not stuck", () => {
    store().clear();
    store().begin("in flight when the tab closed", "text");
    useCapture.setState({ entries: [], hydrated: false });
    store().hydrate();
    const e = store().entries[0];
    expect(e.status).toBe("error");
    expect(e.error ?? "").toMatch(/Interrupted/);
  });

  test("hydrate() is idempotent", () => {
    store().clear();
    store().begin("once", "text");
    store().hydrate();
    store().hydrate();
    expect(store().entries.length).toBe(1);
  });

  test("corrupt stored JSON degrades to an empty log", () => {
    mem.set("lifeos.capture.log.v1", "{not json");
    useCapture.setState({ entries: [], hydrated: false });
    store().hydrate();
    expect(store().entries).toEqual([]);
  });

  test("storage that throws does not break the store", () => {
    const good = (globalThis as unknown as { localStorage: unknown }).localStorage;
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("quota"); },
      removeItem() {}, clear() {},
    };
    useCapture.setState({ entries: [], hydrated: false });
    store().hydrate();                       // read throws
    expect(store().entries).toEqual([]);
    const id = store().begin("still works", "text");   // write throws
    expect(store().entries.length).toBe(1);
    store().resolve(id, { status: "done", reply: "fine" });
    expect(store().entries[0].reply).toBe("fine");
    (globalThis as unknown as { localStorage: unknown }).localStorage = good;
  });
});
