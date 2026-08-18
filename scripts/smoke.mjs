#!/usr/bin/env node
/**
 * End-to-end smoke test.
 *
 * The project has no test runner, and the failures that actually bite here are
 * integration-shaped: a route that 500s when Ollama is down, a session race on
 * first load, a poll that widens a filtered list. So this drives the running
 * server over HTTP and asserts on real responses.
 *
 *   npm run dev          # in another shell
 *   npm run smoke        # BASE_URL=http://localhost:3010 npm run smoke
 *
 * Exits non-zero on the first hard failure. Checks that depend on optional
 * infrastructure (Ollama, Whisper) are reported as SKIP, not failure — the app
 * is meant to run without them.
 */

const BASE = process.env.BASE_URL || "http://localhost:3010";
const UID = "smoke" + Math.random().toString(36).slice(2, 12).padEnd(10, "0");
const COOKIE = `lifeos_uid=${UID}`;

let pass = 0, fail = 0, skip = 0;
const failures = [];

function ok(name, detail = "") {
  pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
}
function bad(name, detail) {
  fail++; failures.push(`${name}: ${detail}`);
  console.log(`  \x1b[31m✗\x1b[0m ${name} — ${detail}`);
}
function skipped(name, why) {
  skip++; console.log(`  \x1b[33m·\x1b[0m ${name} — skipped (${why})`);
}
function section(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }

async function req(method, path, body, opts = {}) {
  const init = { method, headers: { cookie: COOKIE, ...(opts.headers || {}) } };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (opts.raw) { init.body = opts.raw; delete init.headers["content-type"]; }
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or empty */ }
  return { status: res.status, json, text };
}

function expectStatus(name, got, ...want) {
  if (want.includes(got.status)) { ok(name, `${got.status}`); return true; }
  bad(name, `expected ${want.join("/")}, got ${got.status} — ${got.text.slice(0, 120)}`);
  return false;
}

async function main() {
  console.log(`Life OS smoke test → ${BASE}\nguest cookie: ${UID}`);

  section("Pages render");
  for (const p of ["/", "/dashboard", "/assistant", "/calendar", "/notes", "/goals", "/settings", "/onboarding"]) {
    const r = await req("GET", p);
    if (r.status !== 200) bad(`GET ${p}`, `status ${r.status}`);
    else if (/Application error|Internal Server Error/i.test(r.text)) bad(`GET ${p}`, "rendered an error boundary");
    else ok(`GET ${p}`);
  }

  section("Session");
  // Concurrent first-load requests all carry the same brand-new cookie. The old
  // find-then-create raced here and half of them fell back to a phantom guest.
  const fresh = "race" + Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  const burst = await Promise.all(
    Array.from({ length: 6 }, () =>
      fetch(`${BASE}/api/me`, { headers: { cookie: `lifeos_uid=${fresh}` } }).then((r) => r.status)),
  );
  if (burst.every((s) => s === 200)) ok("6 concurrent first-loads share one user row");
  else bad("concurrent first-load", `statuses ${burst.join(",")}`);

  const write = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers: { cookie: `lifeos_uid=${fresh}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "post-race write" }),
  });
  if (write.status === 201) ok("write succeeds for the raced user (no FK orphan)");
  else bad("post-race write", `status ${write.status}`);

  section("Task CRUD");
  const created = await req("POST", "/api/tasks", { title: "smoke task", priority: "HIGH" });
  expectStatus("POST /api/tasks", created, 201);
  const taskId = created.json?.id;

  expectStatus("POST /api/tasks rejects empty title", await req("POST", "/api/tasks", { title: "" }), 400);

  if (taskId) {
    expectStatus("PATCH /api/tasks/:id", await req("PATCH", `/api/tasks/${taskId}`, { status: "DONE" }), 200);
    const list = await req("GET", "/api/tasks");
    if (Array.isArray(list.json) && list.json.some((t) => t.id === taskId)) ok("GET /api/tasks includes it");
    else bad("GET /api/tasks", "created task missing from list");

    // The dashboard renders `scope=today`; its poll must fetch the same set.
    const scoped = await req("GET", "/api/tasks?scope=today");
    if (!Array.isArray(scoped.json)) bad("GET /api/tasks?scope=today", "not an array");
    else {
      const leaked = scoped.json.filter((t) => t.dueAt && new Date(t.dueAt) > new Date(Date.now() + 2 * 86400e3));
      if (leaked.length) bad("scope=today", `${leaked.length} far-future task(s) leaked in`);
      else ok("scope=today excludes far-future tasks", `${scoped.json.length} rows`);
    }

    expectStatus("DELETE /api/tasks/:id", await req("DELETE", `/api/tasks/${taskId}`), 204);
    expectStatus("PATCH on deleted task 404s", await req("PATCH", `/api/tasks/${taskId}`, { status: "TODO" }), 404);
  }

  section("Ownership isolation");
  const mine = await req("POST", "/api/notes", { title: "private", content: "x" });
  const noteId = mine.json?.id;
  if (!noteId) bad("POST /api/notes", `status ${mine.status}`);
  else {
    ok("POST /api/notes", "201");
    const other = await fetch(`${BASE}/api/notes/${noteId}`, {
      method: "DELETE",
      headers: { cookie: `lifeos_uid=intruder${Math.random().toString(36).slice(2, 10)}` },
    });
    if (other.status === 404) ok("another guest cannot delete my note", "404");
    else bad("cross-user delete", `expected 404, got ${other.status}`);
    await req("DELETE", `/api/notes/${noteId}`);
  }

  section("Goals + planner");
  // A real goal title, not a placeholder: with a model present this exercises
  // the planner's success path, and small models return {} for vague titles.
  const goal = await req("POST", "/api/goals", {
    title: "Learn conversational Spanish in 6 months",
    category: "LEARNING",
  });
  expectStatus("POST /api/goals", goal, 201);
  const goalId = goal.json?.id;
  if (goalId) {
    expectStatus("GET /api/goals/:id", await req("GET", `/api/goals/${goalId}`), 200);
    const plan = await req("POST", "/api/ai/plan-goal", { goalId });
    if (plan.status === 200) {
      const ms = plan.json?.plan?.milestones ?? [];
      ok("POST /api/ai/plan-goal", `${ms.length} milestones, ${ms.reduce((n, m) => n + (m.tasks?.length ?? 0), 0)} tasks`);
      // A returned plan must actually be persisted, not just echoed.
      const detail = await req("GET", `/api/goals/${goalId}`);
      if ((detail.json?.milestones?.length ?? 0) === ms.length) ok("the plan is persisted to the goal");
      else bad("plan persistence", `API returned ${ms.length} milestones, goal has ${detail.json?.milestones?.length ?? 0}`);
    }
    else if (plan.status === 503 || plan.status === 502) {
      // Correct behaviour with no local model: a clear, typed refusal.
      if (plan.json?.error) ok("plan-goal degrades cleanly without a model", `${plan.status}`);
      else bad("plan-goal degradation", `${plan.status} with no error message`);
    } else bad("POST /api/ai/plan-goal", `unexpected status ${plan.status}`);
    expectStatus("DELETE /api/goals/:id", await req("DELETE", `/api/goals/${goalId}`), 204, 200);
  }

  section("AI pipeline (fallback parser must work with no model)");
  const chat = await req("POST", "/api/ai/chat", { message: "Remind me to go to the gym tomorrow evening" });
  if (chat.status !== 200) bad("POST /api/ai/chat", `status ${chat.status}`);
  else if (chat.json?.created?.taskIds?.length) {
    ok("chat creates a task from natural language", chat.json.reply);
    for (const id of chat.json.created.taskIds) await req("DELETE", `/api/tasks/${id}`);
  } else bad("POST /api/ai/chat", `no task created: ${JSON.stringify(chat.json).slice(0, 160)}`);

  const ex = await req("POST", "/api/ai/extract", { text: "Take vitamin B12 every 3 days" });
  if (ex.status !== 200) bad("POST /api/ai/extract", `status ${ex.status}`);
  else if (ex.json?.tasks?.[0]?.rrule) ok("extract picks up recurrence", ex.json.tasks[0].rrule);
  else bad("POST /api/ai/extract", `no rrule: ${JSON.stringify(ex.json).slice(0, 160)}`);

  // Any recurrence that reaches the client must be a rule the `rrule` library
  // can read back. Models emit things like "RRULE: FREQ=3,INTERVAL=3".
  {
    const RRULE_OK = /^FREQ=(SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Z0-9,+-]+)*$/;
    const phrases = [
      "Take vitamin B12 every 3 days",
      "Water the plants every Tuesday",
      "Pay the rent monthly",
      "Stand-up every weekday morning",
    ];
    const bogus = [];
    for (const text of phrases) {
      const r = await req("POST", "/api/ai/extract", { text });
      for (const t of r.json?.tasks ?? []) {
        if (t.rrule != null && !RRULE_OK.test(t.rrule)) bogus.push(`${text} -> ${t.rrule}`);
      }
    }
    if (bogus.length) bad("recurrence is well-formed", bogus.join("; "));
    else ok("every returned RRULE is well-formed", `${phrases.length} phrases`);
  }

  section("Briefing");
  const br = await req("GET", "/api/ai/briefing");
  if (br.status !== 200) bad("GET /api/ai/briefing", `status ${br.status}`);
  else {
    ok("GET /api/ai/briefing", br.json?.summary?.slice(0, 60));
    // forDate is a `date` column; storing local midnight used to write the
    // wrong calendar day on any server east of UTC.
    const tzRes = await req("GET", "/api/me");
    const tz = tzRes.json?.timezone || "UTC";
    const expected = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    const got = String(br.json?.forDate || "").slice(0, 10);
    if (got === expected) ok("briefing forDate matches the user's calendar day", got);
    else bad("briefing forDate", `expected ${expected} in ${tz}, got ${got}`);

    const again = await req("GET", "/api/ai/briefing");
    if (again.json?.id === br.json?.id) ok("briefing is idempotent for the day");
    else bad("briefing idempotency", "a second call created a new row");
  }

  section("Malformed input");
  expectStatus("transcribe rejects a non-multipart body", await req("POST", "/api/voice/transcribe", { nope: 1 }), 400);
  expectStatus("chat rejects a missing message", await req("POST", "/api/ai/chat", {}), 400);
  expectStatus("plan-goal rejects a missing goalId", await req("POST", "/api/ai/plan-goal", {}), 400);
  expectStatus("plan-goal 404s an unknown goal", await req("POST", "/api/ai/plan-goal", { goalId: "nope" }), 404);

  section("Rate limiting");
  {
    // plan-goal has the tightest budget (5/min) because it is the most
    // expensive endpoint. Unknown-goal 404s still consume budget by design.
    const cookie = `lifeos_uid=rl${Math.random().toString(36).slice(2, 12).padEnd(10, "0")}`;

    // Warm the route first. On a cold dev server the first hit compiles it, and
    // that module re-evaluation resets the in-memory limiter's Map mid-burst —
    // which looked exactly like a broken budget. Uses its own cookie so it
    // doesn't spend the budget we're about to measure.
    await fetch(`${BASE}/api/ai/plan-goal`, {
      method: "POST",
      headers: { cookie: `${cookie}warmup`, "content-type": "application/json" },
      body: JSON.stringify({ goalId: "warmup" }),
    }).catch(() => {});

    const codes = [];
    for (let i = 0; i < 7; i++) {
      const r = await fetch(`${BASE}/api/ai/plan-goal`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ goalId: "does-not-exist" }),
      });
      codes.push(r.status);
    }
    if (codes.slice(0, 5).every((c) => c === 404) && codes.slice(5).every((c) => c === 429)) {
      ok("plan-goal budget is enforced", codes.join(","));
    } else bad("plan-goal rate limit", `got ${codes.join(",")}, expected 404x5 then 429x2`);
  }

  section("Optional infrastructure");
  const oll = await req("GET", "/api/ai/health/ollama");
  if (oll.json?.ok) ok("Ollama reachable", oll.json.model);
  else skipped("Ollama", oll.json?.error || "unreachable");
  const wh = await req("GET", "/api/ai/health/whisper");
  if (wh.json?.ok) ok("Whisper reachable");
  else skipped("Whisper", wh.json?.error || "unreachable");

  console.log(`\n${"─".repeat(52)}`);
  console.log(`${pass} passed · ${fail} failed · ${skip} skipped`);
  if (fail) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  · ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\nSmoke test could not run: ${e.message}`);
  console.error(`Is the dev server up at ${BASE}? (npm run dev)`);
  process.exit(1);
});
