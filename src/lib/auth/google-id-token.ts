/**
 * Google Identity Services sign-in — verified with no client secret.
 *
 * GIS hands the browser a signed ID token (a JWT) asserting who the user is.
 * Verifying it needs only Google's public keys and our **client ID**, which is
 * a public value that ships inside every Google web app — not a secret. So this
 * app can authenticate people without any credential on disk.
 *
 * The OAuth *authorization code* flow is a different matter: Google will not
 * issue a refresh token without a client secret, which is why two-way calendar
 * sync stays behind the separate `/api/calendar/google/connect` route and is
 * simply unavailable wherever no secret is configured.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";

const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");

/**
 * Google's signing keys, cached across requests. `createRemoteJWKSet` handles
 * rotation and rate-limits its own refetches, so this must be module-level —
 * rebuilding it per request would fetch the key set on every sign-in.
 */
const jwks = createRemoteJWKSet(JWKS_URL);

/** The public client ID. Safe in client code; deliberately NEXT_PUBLIC_. */
export function googleClientId(): string | null {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || null;
}

export interface GoogleIdentity {
  googleId: string;
  email: string;
  name: string | null;
  picture: string | null;
}

// ── Nonce ─────────────────────────────────────────────────────
//
// A stolen ID token could otherwise be replayed. GIS embeds a nonce we choose,
// so we can insist each token was minted for one specific sign-in attempt.
//
// The nonce is authenticated with an HMAC over its own expiry rather than
// stored server-side: no cookie to go missing, no row to clean up, and it works
// unchanged across serverless instances.

const NONCE_TTL_MS = 10 * 60_000;

/**
 * Web Crypto, not `node:crypto`.
 *
 * `middleware.ts` imports the Auth.js config, which reaches this module, and
 * middleware runs on the edge runtime — a `node:crypto` import there fails the
 * build outright with an unhandled-scheme error. Web Crypto is available in
 * both runtimes, at the cost of these helpers being async.
 */
function subtle(): SubtleCrypto {
  return globalThis.crypto.subtle;
}

function nonceSecret(): string {
  const s = process.env.AUTH_SECRET?.trim();
  if (!s) throw new Error("AUTH_SECRET is required to sign sign-in nonces");
  return s;
}

const encoder = new TextEncoder();

async function hmacKey(): Promise<CryptoKey> {
  return subtle().importKey(
    "raw",
    encoder.encode(nonceSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const byte of b) out += String.fromCharCode(byte);
  return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(value: string): Promise<string> {
  return base64url(await subtle().sign("HMAC", await hmacKey(), encoder.encode(value)));
}

/** Length-safe, data-independent string comparison. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Mint a nonce for one sign-in attempt: `<random>.<expiry>.<hmac>`. */
export async function mintNonce(): Promise<string> {
  const rand = base64url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const body = `${rand}.${Date.now() + NONCE_TTL_MS}`;
  return `${body}.${await sign(body)}`;
}

/** True when `nonce` is one we minted and it hasn't expired. */
export async function verifyNonce(nonce: string | null | undefined): Promise<boolean> {
  if (!nonce) return false;
  const parts = nonce.split(".");
  if (parts.length !== 3) return false;
  const [rand, expiry, mac] = parts;

  if (!constantTimeEqual(mac, await sign(`${rand}.${expiry}`))) return false;

  const exp = Number(expiry);
  return Number.isFinite(exp) && exp > Date.now();
}

/**
 * Verify a GIS credential and return the identity it asserts.
 *
 * Throws with a specific reason on every rejection path — the caller turns that
 * into a generic message for the user, but the server log needs to say which
 * check failed.
 */
export async function verifyGoogleIdToken(
  credential: string,
  expectedNonce: string,
): Promise<GoogleIdentity> {
  const clientId = googleClientId();
  if (!clientId) throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set");
  if (!(await verifyNonce(expectedNonce))) {
    throw new Error("sign-in nonce is invalid or expired");
  }

  // `jwtVerify` checks the signature against Google's JWKS and enforces
  // audience, issuer and expiry. Anything it doesn't cover is checked below.
  const { payload } = await jwtVerify(credential, jwks, {
    issuer: ISSUERS,
    audience: clientId,
    // Tokens are short-lived; allow a little clock skew, not minutes of it.
    clockTolerance: "30s",
  });

  if (payload.nonce !== expectedNonce) {
    throw new Error("ID token nonce does not match this sign-in attempt");
  }

  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  if (!email) throw new Error("ID token carries no email");
  // Google normally only asserts verified addresses, but an unverified one must
  // never be trusted to match an existing account by email.
  if (payload.email_verified !== true) throw new Error("Google has not verified this email");

  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!sub) throw new Error("ID token carries no subject");

  return {
    googleId: sub,
    email,
    name: typeof payload.name === "string" ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}
