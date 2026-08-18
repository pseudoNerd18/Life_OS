#!/usr/bin/env node
/**
 * Browser end-to-end test for the notes editor (BlockNote).
 *
 * `scripts/smoke.mjs` drives the HTTP API, which cannot reach what actually
 * breaks in a rich-text editor: does the slash menu open, does a block survive
 * a save/reload round-trip, does an old TipTap-era note still render, does the
 * theme bridge win against BlockNote's own CSS. Those need a real browser.
 *
 *   npm run dev            # in another shell
 *   npm run test:notes     # BASE_URL=http://localhost:3010 npm run test:notes
 *
 * One-time setup (downloads a ~120MB browser):
 *   npx playwright install chromium
 *
 * Exits non-zero if any check fails. Screenshots of both themes are written to
 * .test-output/ for eyeballing.
 */
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3010";
const OUT = ".test-output";

let pass = 0, fail = 0;
const failures = [];
const ok = (n, d = "") => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? ` — ${d}` : ""}`); };
const bad = (n, d) => { fail++; failures.push(`${n}: ${d}`); console.log(`  \x1b[31m✗\x1b[0m ${n} — ${d}`); };
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("playwright is not installed.\n  npm i -D playwright && npx playwright install chromium");
  process.exit(1);
}

// Fail fast with a useful message rather than a 30s locator timeout.
try {
  const r = await fetch(`${BASE}/notes`);
  if (!r.ok) throw new Error(`GET /notes → ${r.status}`);
} catch (err) {
  console.error(`Is the dev server up at ${BASE}? (npm run dev)\n  ${err.message}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
console.log(`Notes editor e2e → ${BASE}`);

let browser;
try {
  browser = await chromium.launch();
} catch (err) {
  console.error(`Could not launch Chromium — run: npx playwright install chromium\n  ${err.message}`);
  process.exit(1);
}

// A fresh browser context means a fresh guest cookie, so this run gets its own
// isolated set of notes and never sees (or disturbs) your real ones.
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

const editor = page.locator(".bn-editor");

try {
  section("editor mounts");
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /new note/i }).click();
  await editor.waitFor({ state: "visible", timeout: 30_000 });
  ok("BlockNote mounted", ".bn-editor is present");

  section("typing and the slash menu");
  await page.locator('input[placeholder="Untitled"]').fill("BlockNote e2e");
  await editor.click();
  await page.keyboard.type("First paragraph of the note.");

  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await page
    .locator('.bn-suggestion-menu, [role="listbox"]')
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => ok("slash menu opens"), () => bad("slash menu", "did not open"));
  await page.keyboard.type("Heading 2");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A heading via the slash menu");

  await page.keyboard.press("Enter");
  await page.keyboard.type("/check");
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.keyboard.type("a checkable todo");

  const live = await editor.innerHTML();
  for (const [label, re] of [
    ["paragraph", /First paragraph/],
    ["heading", /<h2/i],
    ["check list", /type="checkbox"/i],
  ]) {
    if (re.test(live)) ok(`${label} renders`);
    else bad(label, "not in the DOM");
  }

  section("autosave survives a reload");
  await page.waitForTimeout(4_000); // autosave ticks every 2.5s
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByText("BlockNote e2e").first().click();
  await editor.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(1_500);
  const reloaded = await editor.innerHTML();
  for (const [label, re] of [
    ["paragraph", /First paragraph of the note\./],
    ["heading", /<h2/i],
    ["check list", /type="checkbox"/i],
  ]) {
    if (re.test(reloaded)) ok(`${label} persisted`);
    else bad(label, "lost on reload");
  }

  section("pre-BlockNote notes still open");
  // Notes written by the old TipTap editor are plain HTML in the same column.
  const status = await page.evaluate(async () => {
    const r = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Legacy TipTap note",
        content:
          "<h1>Legacy heading</h1><p>Old <strong>tiptap</strong> paragraph</p><ul><li>bullet one</li></ul>",
      }),
    });
    return r.status;
  });
  if (status === 201) ok("legacy note created");
  else bad("legacy note", `POST returned ${status}`);

  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByText("Legacy TipTap note").first().click();
  await editor.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(1_200);
  const legacy = await editor.innerHTML();
  for (const [label, re] of [
    ["heading", /Legacy heading/],
    ["bullet", /bullet one/],
    ["inline bold", /<strong|<b>/i],
  ]) {
    if (re.test(legacy)) ok(`legacy ${label} parsed into a block`);
    else bad(`legacy ${label}`, "not parsed");
  }

  section("theme bridge beats BlockNote's own CSS");
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
    await page.getByText("Legacy TipTap note").first().click();
    await editor.waitFor({ state: "visible", timeout: 30_000 });
    const v = await page.locator(".bn-root").first().evaluate((el) => ({
      token: getComputedStyle(el).getPropertyValue("--bn-colors-editor-text").trim(),
      color: getComputedStyle(el.querySelector(".bn-editor")).color,
      appFg: getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim(),
    }));
    // Ours resolve through hsl(var(--foreground)); BlockNote's defaults are hex.
    if (v.token.startsWith("hsl(")) ok(`${scheme}: driven by app tokens`, `${v.token} → ${v.color}`);
    else bad(`${scheme} theme`, `BlockNote default still winning (${v.token})`);
    await page.screenshot({ path: `${OUT}/notes-${scheme}.png` });
  }

  const real = consoleErrors.filter((e) => !/favicon|React DevTools|hydrat/i.test(e));
  if (real.length) {
    section("console errors");
    real.slice(0, 8).forEach((e) => bad("console", e.slice(0, 200)));
  }
} finally {
  await browser.close();
}

console.log("\n" + "─".repeat(52));
console.log(`${pass} passed · ${fail} failed`);
console.log(`screenshots → ${OUT}/notes-light.png, ${OUT}/notes-dark.png`);
if (fail) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
