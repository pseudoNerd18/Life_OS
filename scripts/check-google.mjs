#!/usr/bin/env node
/**
 * Diagnose Google sign-in configuration.
 *
 * "Google auth is not working" has a handful of causes and they look identical
 * from the browser, so this checks each one and says which is wrong.
 *
 *   npm run check:google
 */
const ok   = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad  = (m, fix) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); if (fix) console.log(`      → ${fix}`); problems++; };
const note = (m) => console.log(`  \x1b[33m·\x1b[0m ${m}`);
let problems = 0;

try { process.loadEnvFile(".env"); } catch { bad("no .env file found", "cp .env.example .env"); }

console.log("\n\x1b[1mGoogle sign-in (public client ID)\x1b[0m");

const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
if (!clientId) {
  bad("NEXT_PUBLIC_GOOGLE_CLIENT_ID is empty or unset",
      "Google Cloud → Credentials → OAuth client ID (Web application), then paste it into .env");
} else if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
  bad(`NEXT_PUBLIC_GOOGLE_CLIENT_ID doesn't look like a client ID: ${clientId.slice(0, 24)}…`,
      "It should end in .apps.googleusercontent.com — you may have pasted the secret");
} else {
  ok(`client ID present (…${clientId.slice(-30)})`);
}

if (!process.env.AUTH_SECRET?.trim()) {
  bad("AUTH_SECRET is empty — sessions can't be signed and nonces can't be minted",
      "npx auth secret");
} else {
  ok("AUTH_SECRET present");
}

const authUrl = process.env.AUTH_URL?.trim();
if (!authUrl) note("AUTH_URL unset — fine locally, required when deployed");
else ok(`AUTH_URL = ${authUrl}`);

// Google refuses a GIS request whose page origin isn't registered.
const origin = authUrl?.replace(/\/$/, "") || "http://localhost:3010";
note(`Authorised JavaScript origin must be exactly: ${origin}`);
note("GIS does not redirect — a redirect URI is not used for sign-in");
note("Every Google address you sign in with must be listed under");
note("  Google Auth Platform → Audience → Test users, or CALENDAR access is");
note("  refused with 403 access_denied while the app is in Testing mode");

console.log("\n\x1b[1mGoogle Calendar sync (needs a real secret)\x1b[0m");
const calId = process.env.GOOGLE_CLIENT_ID?.trim();
const calSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
if (!calId || !calSecret) {
  note("not configured — sign-in is unaffected; the calendar shows internal events only");
  note("this is expected if you're keeping this machine free of secrets");
} else {
  ok("client id + secret present — two-way sync available");
  note(`redirect URI must include: ${origin}/api/calendar/google/callback`);
}

// Report the exact origins that must be registered. We deliberately do NOT
// probe Google's gsi/status endpoint any more: it answers 403 to a server-side
// request whatever the configuration, so it produced confident false failures
// for a client ID that worked fine in a browser.
if (clientId) {
  console.log("\n\x1b[1mAuthorised JavaScript origins\x1b[0m");
  note("Register EVERY origin you open the app on. They must match exactly —");
  note("scheme, host and port all count, and localhost !== 127.0.0.1:");
  console.log(`      ${origin}`);

  // Next falls back to another port when the default is taken, which silently
  // changes the origin and is the usual cause of "Error 400: origin_mismatch".
  const ports = [3000, 3001, 3002, 3003];
  const live = [];
  for (const p of ports) {
    try {
      const r = await fetch(`http://localhost:${p}/login`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) live.push(p);
    } catch { /* nothing listening */ }
  }
  if (live.length === 0) {
    note("No dev server is running, so the live origin can't be confirmed.");
  } else {
    for (const p of live) {
      const o = `http://localhost:${p}`;
      if (o === origin) ok(`dev server on ${o} matches AUTH_URL`);
      else bad(`a dev server is running on ${o}, which is NOT your AUTH_URL (${origin})`,
               `either register ${o} as a JavaScript origin too, or free port ${new URL(origin).port} and restart`);
    }
  }
  note("Whatever is in the browser address bar is the origin Google checks.");
}

console.log("\n\x1b[1mReachability\x1b[0m");
try {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/certs", {
    signal: AbortSignal.timeout(8000),
  });
  const j = await res.json();
  if (res.ok && Array.isArray(j.keys) && j.keys.length) {
    ok(`Google's public keys are reachable (${j.keys.length} signing keys)`);
  } else {
    bad(`unexpected response from Google's JWKS endpoint (${res.status})`);
  }
} catch (err) {
  bad(`cannot reach Google's public keys: ${err.message}`,
      "ID tokens can't be verified offline — check your network or proxy");
}

console.log("\n" + "─".repeat(52));
if (problems) {
  console.log(`${problems} problem${problems > 1 ? "s" : ""} found. Fix the ✗ lines, then restart the dev server.`);
  process.exit(1);
}
console.log("Configuration looks good. Restart the dev server if you just edited .env.");
