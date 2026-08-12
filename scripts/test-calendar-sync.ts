/**
 * Integration test for two-way Google Calendar sync.
 *
 * Runs the real sync engine — `lib/calendar/sync.ts`, unmodified — against a
 * stand-in Google (`mock-google.ts`) and a real Postgres. This is the only way
 * to exercise echo suppression, conflict resolution, tombstones, pagination and
 * 410 recovery without live OAuth credentials.
 *
 *   npm run test:calendar        (needs DATABASE_URL; docker compose up postgres)
 *
 * All rows are created under a throwaway user and deleted afterwards, so it is
 * safe to run against your dev database.
 */
import assert from "node:assert/strict";
import { startMockGoogle, type MockEvent, type MockGoogle } from "./mock-google";

// tsx doesn't read .env, and this test needs the real DATABASE_URL.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the DATABASE_URL check below reports it properly.
}

let pass = 0;
const failures: string[] = [];

function section(t: string) { console.log(`\n\x1b[1m${t}\x1b[0m`); }
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${(e as Error).message.split("\n")[0]}`);
  }
}

const USER_ID = "caltest-" + Math.random().toString(36).slice(2, 10);
const HOUR = 3_600_000;

/** Fetch an event the test has already asserted exists. */
function remote(mock: MockGoogle, id: string | null): MockEvent {
  assert.ok(id, "expected a linked externalId");
  const e = mock.events.get(id);
  assert.ok(e, `expected event ${id} to exist in the mock`);
  return e;
}

async function main() {
  const mock: MockGoogle = await startMockGoogle();
  // Must be set BEFORE the modules under test are imported, since the base URL
  // is read at module scope.
  process.env.GOOGLE_API_BASE = mock.url;
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";

  const { prisma, dbMode } = await import("../src/lib/db");
  if (dbMode() !== "prisma") {
    console.error("This test needs a real database (DATABASE_URL). Skipping.");
    await mock.close();
    process.exit(0);
  }
  const { syncAccount } = await import("../src/lib/calendar/sync");

  const now = Date.now();
  let accountId = "";

  async function freshAccount(expiresAt = new Date(now + HOUR)) {
    const a = await prisma.calendarAccount.create({
      data: {
        userId: USER_ID, provider: "GOOGLE", email: "test@example.com",
        accessToken: "initial-access-token", refreshToken: "test-refresh-token",
        expiresAt, scope: "calendar.events", calendarId: "primary", isActive: true,
      },
    });
    accountId = a.id;
    return a;
  }
  const reload = () => prisma.calendarAccount.findUnique({ where: { id: accountId } });

  try {
    await prisma.user.create({
      // `email` is required to be unique and the sync engine keys
      // CalendarAccount on it, so the throwaway user needs a unique one.
      data: {
        id: USER_ID,
        email: `${USER_ID}@calendar-test.local`,
        name: "Calendar Test",
        timezone: "UTC",
      },
    });

    // ── Pull ────────────────────────────────────────────────
    section("pull: Google events become CalendarEvent rows");
    mock.put({
      id: "remote-1", summary: "Standup",
      start: { dateTime: new Date(now + HOUR).toISOString() },
      end: { dateTime: new Date(now + 2 * HOUR).toISOString() },
      location: "Room 2", attendees: [{ email: "a@x.com" }, { email: "b@x.com" }],
    });
    mock.put({
      id: "remote-allday", summary: "Holiday",
      start: { date: "2026-04-01" }, end: { date: "2026-04-02" },
    });

    let account = await freshAccount();
    let r = await syncAccount(account, { timeZone: "UTC" });

    await test("both remote events were mirrored", async () => {
      assert.equal(r.pulled, 2, `pulled ${r.pulled}`);
      const rows = await prisma.calendarEvent.findMany({ where: { userId: USER_ID } });
      assert.equal(rows.length, 2);
    });
    await test("event fields are mapped, not dropped", async () => {
      const e = await prisma.calendarEvent.findFirst({
        where: { userId: USER_ID, externalId: "remote-1" },
      });
      assert.equal(e.title, "Standup");
      assert.equal(e.location, "Room 2");
      assert.deepEqual(e.attendees, ["a@x.com", "b@x.com"]);
      assert.equal(e.allDay, false);
    });
    await test("an all-day event is flagged all-day", async () => {
      const e = await prisma.calendarEvent.findFirst({
        where: { userId: USER_ID, externalId: "remote-allday" },
      });
      assert.equal(e.allDay, true);
    });
    await test("a sync cursor was stored for next time", async () => {
      assert.ok((await reload()).syncToken, "syncToken should be set");
    });
    await test("no errors were swallowed", () => assert.deepEqual(r.errors, []));

    // ── Incremental ────────────────────────────────────────
    section("pull: the second sync is incremental");
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });
    await test("an unchanged calendar re-pulls nothing", () =>
      assert.equal(r.pulled, 0, `pulled ${r.pulled}`));

    mock.put({
      id: "remote-2", summary: "New meeting",
      start: { dateTime: new Date(now + 3 * HOUR).toISOString() },
      end: { dateTime: new Date(now + 4 * HOUR).toISOString() },
    });
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });
    await test("only the newly added event comes through", () =>
      assert.equal(r.pulled, 1, `pulled ${r.pulled}`));

    // ── Tombstones ─────────────────────────────────────────
    section("pull: cancelled events are removed");
    mock.put({ id: "remote-2", status: "cancelled" });
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });
    await test("the mirrored row is deleted", async () => {
      assert.equal(r.removed, 1, `removed ${r.removed}`);
      const gone = await prisma.calendarEvent.findFirst({
        where: { userId: USER_ID, externalId: "remote-2" },
      });
      assert.equal(gone, null);
    });

    // ── Push ───────────────────────────────────────────────
    section("push: dated tasks become Google events");
    const task = await prisma.task.create({
      data: {
        userId: USER_ID, title: "Write the report",
        dueAt: new Date(now + 5 * HOUR), durationMin: 45, status: "TODO",
      },
    });
    const unscheduled = await prisma.task.create({
      data: { userId: USER_ID, title: "Someday idea", status: "TODO" },
    });

    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });

    await test("the dated task was created in Google", async () => {
      assert.equal(r.pushed, 1, `pushed ${r.pushed}`);
      const t = await prisma.task.findUnique({ where: { id: task.id } });
      assert.ok(t.externalId, "task should have an externalId");
      assert.equal(t.calendarAccountId, accountId);
      assert.ok(t.syncedAt, "task should have syncedAt");
      assert.equal(remote(mock, t.externalId).summary, "Write the report");
    });
    await test("duration is honoured (45min, not the 30min default)", async () => {
      const t = await prisma.task.findUnique({ where: { id: task.id } });
      const e = t?.externalId ? mock.events.get(t.externalId) : undefined;
      // Assert rather than optional-chain through: a missing event means the
      // push failed, and that should fail loudly here, not divide by undefined.
      assert.ok(e, "the task should have been pushed to Google");
      assert.ok(e.start?.dateTime && e.end?.dateTime, "the event should be timed, not all-day");
      const mins = (new Date(e.end.dateTime).getTime() - new Date(e.start.dateTime).getTime()) / 60000;
      assert.equal(mins, 45);
    });
    await test("the pushed event carries our marker", async () => {
      const t = await prisma.task.findUnique({ where: { id: task.id } });
      const e = remote(mock, t.externalId);
      assert.equal(e.extendedProperties?.private?.lifeosTaskId, task.id);
    });
    await test("an unscheduled task is NOT pushed", async () => {
      const t = await prisma.task.findUnique({ where: { id: unscheduled.id } });
      assert.equal(t.externalId, null);
    });

    // ── Echo suppression ───────────────────────────────────
    section("echo suppression: our own events don't come back as events");
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });
    await test("the event we pushed is not mirrored into CalendarEvent", async () => {
      const t = await prisma.task.findUnique({ where: { id: task.id } });
      const dupe = await prisma.calendarEvent.findFirst({
        where: { userId: USER_ID, externalId: t.externalId },
      });
      assert.equal(dupe, null, "our own pushed event must not become a CalendarEvent row");
    });
    await test("so the task appears on the calendar exactly once", async () => {
      const events = await prisma.calendarEvent.count({ where: { userId: USER_ID } });
      assert.equal(events, 2, `expected the 2 genuinely-remote events, got ${events}`);
    });
    await test("an idle sync writes nothing", () => {
      assert.equal(r.pushed, 0, `pushed ${r.pushed}`);
      assert.equal(r.updated, 0, `updated ${r.updated}`);
    });

    // ── Local edit wins ────────────────────────────────────
    section("conflict: only the task changed → push");
    await new Promise((s) => setTimeout(s, 15));
    await prisma.task.update({ where: { id: task.id }, data: { title: "Write the report (v2)" } });
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });
    await test("Google receives the new title", async () => {
      assert.equal(r.updated, 1, `updated ${r.updated}`);
      const t = await prisma.task.findUnique({ where: { id: task.id } });
      assert.equal(remote(mock, t.externalId).summary, "Write the report (v2)");
    });
    await test("it is not counted as a conflict", () => assert.deepEqual(r.conflicts, []));

    // ── Remote edit wins ───────────────────────────────────
    section("conflict: only Google changed → pull onto the task");
    let t2 = await prisma.task.findUnique({ where: { id: task.id } });
    await new Promise((s) => setTimeout(s, 15));
    mock.put({
      ...remote(mock, t2.externalId),
      summary: "Renamed in Google",
      start: { dateTime: new Date(now + 9 * HOUR).toISOString() },
      end: { dateTime: new Date(now + 10 * HOUR).toISOString() },
    });
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });
    await test("the remote rename lands on the task", async () => {
      assert.equal(r.appliedRemote, 1, `appliedRemote ${r.appliedRemote}`);
      const t = await prisma.task.findUnique({ where: { id: task.id } });
      assert.equal(t.title, "Renamed in Google");
      assert.equal(t.durationMin, 60, "duration should follow the remote span");
    });
    await test("a one-sided remote edit is not a conflict", () =>
      assert.deepEqual(r.conflicts, []));

    // ── Genuine conflict ───────────────────────────────────
    section("conflict: both sides changed → newest wins, and it's reported");
    t2 = await prisma.task.findUnique({ where: { id: task.id } });
    await prisma.task.update({ where: { id: task.id }, data: { title: "Local edit" } });
    await new Promise((s) => setTimeout(s, 15));
    // Remote is touched last, so remote should win.
    mock.put({ ...remote(mock, t2.externalId), summary: "Remote edit, later" });
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });
    await test("the later side (Google) wins", async () => {
      const t = await prisma.task.findUnique({ where: { id: task.id } });
      assert.equal(t.title, "Remote edit, later");
    });
    await test("the conflict is reported, not silent", () => {
      assert.equal(r.conflicts.length, 1, JSON.stringify(r.conflicts));
      assert.equal(r.conflicts[0].winner, "remote");
    });

    // ── Reap ───────────────────────────────────────────────
    section("reap: a cancelled task gives up its slot");
    t2 = await prisma.task.findUnique({ where: { id: task.id } });
    const externalBeforeCancel = t2.externalId;
    await prisma.task.update({ where: { id: task.id }, data: { status: "CANCELLED" } });
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });
    await test("the Google event is deleted", () => {
      assert.equal(r.reaped, 1, `reaped ${r.reaped}`);
      assert.equal(mock.events.has(externalBeforeCancel), false);
    });
    await test("the task is unlinked but still exists", async () => {
      const t = await prisma.task.findUnique({ where: { id: task.id } });
      assert.ok(t, "task must not be deleted");
      assert.equal(t.externalId, null);
    });

    // ── Deleted upstream ───────────────────────────────────
    section("a task's event deleted in Google unlinks, never deletes the task");
    const t3 = await prisma.task.create({
      data: { userId: USER_ID, title: "Will vanish", dueAt: new Date(now + 11 * HOUR), status: "TODO" },
    });
    account = (await reload())!;
    await syncAccount(account, { timeZone: "UTC" });
    let t3r = await prisma.task.findUnique({ where: { id: t3.id } });
    assert.ok(t3r.externalId, "precondition: it was pushed");
    mock.put({ id: t3r.externalId as string, status: "cancelled" });
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });
    await test("the task survives and is unlinked", async () => {
      t3r = await prisma.task.findUnique({ where: { id: t3.id } });
      assert.ok(t3r, "task must survive");
      assert.equal(t3r.externalId, null, "link should be dropped");
    });
    await test("the deletion is not undone in the same run", () => {
      assert.deepEqual(r.unlinked, [t3.id]);
      assert.equal(r.pushed, 0, "must not immediately re-create the event");
    });

    // ── Provenance ─────────────────────────────────────────
    //
    // What a tombstone means depends on where the row came from. A plain mirror
    // of a remote event must go when that event goes; anything the user owns
    // must survive. `syncedAt` cannot tell these apart — it is set on every
    // mirror at first pull — which is why `mirrored` exists.
    section("a tombstone deletes a mirror but never a locally-owned event");

    await test("a pulled row records that it is a mirror", async () => {
      const e = await prisma.calendarEvent.findFirst({
        where: { userId: USER_ID, externalId: "remote-1" },
      });
      assert.ok(e, "precondition: remote-1 is still mirrored in");
      assert.equal(e.mirrored, true, "pull must record provenance");
    });

    // (a) Created here, pushed out, then deleted at the far end.
    const localEv = await prisma.calendarEvent.create({
      data: {
        userId: USER_ID, accountId, title: "Dinner with friends",
        startAt: new Date(now + 30 * HOUR), endAt: new Date(now + 31 * HOUR),
      },
    });
    account = (await reload())!;
    await syncAccount(account, { timeZone: "UTC" });
    let localRow = await prisma.calendarEvent.findUnique({ where: { id: localEv.id } });
    assert.ok(localRow?.externalId, "precondition: the local event reached Google");
    assert.equal(localRow.mirrored, false, "precondition: it is not a mirror");
    mock.put({ id: localRow.externalId as string, status: "cancelled" });
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });

    await test("an event created here survives being deleted in Google", async () => {
      localRow = await prisma.calendarEvent.findUnique({ where: { id: localEv.id } });
      assert.ok(localRow, "the user's own event must not be destroyed");
      assert.equal(localRow.externalId, null, "it should be unlinked");
      assert.equal(localRow.accountId, null);
      assert.ok(r.unlinked.includes(localEv.id), "and reported as unlinked");
    });
    await test("unlinking a local event is not counted as a removal", () =>
      assert.equal(r.removed, 0, `removed ${r.removed}`));

    // (b) Mirrored in, then edited here before the tombstone arrived. The edit
    //     is local intent even though the row started life as somebody else's.
    mock.put({
      id: "remote-edited", summary: "Team sync",
      start: { dateTime: new Date(now + 40 * HOUR).toISOString() },
      end: { dateTime: new Date(now + 41 * HOUR).toISOString() },
    });
    account = (await reload())!;
    await syncAccount(account, { timeZone: "UTC" });
    const mirroredRow = await prisma.calendarEvent.findFirst({
      where: { userId: USER_ID, externalId: "remote-edited" },
    });
    assert.ok(mirroredRow, "precondition: it was mirrored in");
    // Past the agreement point, so the edit is visibly newer than `syncedAt`.
    await new Promise((s) => setTimeout(s, 15));
    await prisma.calendarEvent.update({
      where: { id: mirroredRow.id }, data: { title: "Team sync (moved)" },
    });
    mock.put({ id: "remote-edited", status: "cancelled" });
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });

    await test("a mirror holding an unsynced local edit is unlinked, not deleted", async () => {
      const row = await prisma.calendarEvent.findUnique({ where: { id: mirroredRow.id } });
      assert.ok(row, "an edit made here must not be destroyed");
      assert.equal(row.title, "Team sync (moved)", "and the edit must survive intact");
      assert.equal(row.externalId, null, "it should be unlinked");
      assert.equal(row.mirrored, false, "with nothing left to mirror");
    });

    // (c) The case DEF-01 got wrong: an untouched mirror really must go.
    mock.put({
      id: "remote-untouched", summary: "Someone else's meeting",
      start: { dateTime: new Date(now + 44 * HOUR).toISOString() },
      end: { dateTime: new Date(now + 45 * HOUR).toISOString() },
    });
    account = (await reload())!;
    await syncAccount(account, { timeZone: "UTC" });
    mock.put({ id: "remote-untouched", status: "cancelled" });
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });

    await test("an untouched mirror is deleted, leaving no ghost row", async () => {
      const row = await prisma.calendarEvent.findFirst({
        where: { userId: USER_ID, externalId: "remote-untouched" },
      });
      assert.equal(row, null, "a mirror of a deleted event must not linger");
      assert.equal(r.removed, 1, `removed ${r.removed}`);
      assert.deepEqual(r.unlinked, [], "a mirror is removed, not unlinked");
    });

    // ── 410 recovery ───────────────────────────────────────
    section("a stale sync token triggers a full resync, not a crash");
    mock.expireSyncToken();
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });
    await test("the engine recovers and reports a full resync", () => {
      assert.equal(r.fullResync, true);
      assert.deepEqual(r.errors, []);
    });
    await test("a fresh cursor is stored", async () =>
      assert.ok((await reload()).syncToken));

    // ── Pagination ─────────────────────────────────────────
    section("pagination is followed to the end");
    mock.pageSize = 2;
    for (let i = 0; i < 7; i++) {
      mock.put({
        id: `page-${i}`, summary: `Paged ${i}`,
        start: { dateTime: new Date(now + (20 + i) * HOUR).toISOString() },
        end: { dateTime: new Date(now + (21 + i) * HOUR).toISOString() },
      });
    }
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });
    await test("all 7 events arrive across multiple pages", () =>
      assert.equal(r.pulled, 7, `pulled ${r.pulled}`));
    mock.pageSize = 250;

    // ── Token refresh ──────────────────────────────────────
    section("an expired access token is refreshed mid-sync");
    await prisma.calendarAccount.update({
      where: { id: accountId },
      data: { expiresAt: new Date(now - HOUR), accessToken: "stale-token" },
    });
    account = (await reload())!;
    r = await syncAccount(account, { timeZone: "UTC" });
    await test("the refreshed token is persisted", async () => {
      const a = await reload();
      assert.equal(a.accessToken, mock.refreshedAccessToken);
      assert.ok(a.expiresAt > new Date(), "new expiry should be in the future");
    });
    await test("the sync still completed", () => assert.deepEqual(r.errors, []));
  } finally {
    // Clean up everything this test created.
    await prisma.calendarEvent.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.task.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.calendarAccount.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.user.delete({ where: { id: USER_ID } }).catch(() => {});
    await mock.close();
    await prisma.$disconnect?.().catch(() => {});
  }

  console.log(`\n${"─".repeat(52)}`);
  console.log(`${pass} passed · ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  · ${f}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
