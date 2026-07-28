/**
 * Signing for the public TwiML endpoint.
 *
 * `/api/calls/twiml` has to be reachable by Twilio, which means reachable by
 * anyone who finds the tunnel URL. Unsigned, it would be a machine that reads
 * arbitrary attacker-supplied text aloud down a phone line — so the message and
 * its signature travel together and the route renders nothing without a match.
 *
 * Keyed on AUTH_SECRET, which the app already requires. Nothing here depends on
 * the tunnel's hostname, so a URL that changes between restarts stays valid.
 *
 * Web Crypto rather than `node:crypto`, which makes these async: this module is
 * reachable from `instrumentation.ts`, and Next compiles that for the edge
 * runtime too, where a `node:` import fails the entire app build.
 */

function keyMaterial(): Uint8Array {
  // Falling back to a constant would make the signature decorative. Better to
  // fail loudly at call time than to quietly ship an open endpoint.
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET is required to sign TwiML requests");
  return new TextEncoder().encode(secret);
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", keyMaterial(), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signMessage(message: string): Promise<string> {
  return hmac(message);
}

/** Constant-time compare, so the signature can't be recovered by timing. */
export async function verifyMessage(message: string, signature: string): Promise<boolean> {
  if (!signature) return false;
  let expected: string;
  try {
    expected = await hmac(message);
  } catch {
    return false;
  }
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Pack the message into the URL as base64url.
 *
 * Twilio rewrites the URL before fetching it, decoding percent-escapes as it
 * goes — so a `%26` we send arrives as a bare `&` and silently truncates the
 * parameter mid-sentence. Any event titled "Design & Review" would break, and
 * the failure looks like an unreachable server rather than a mangled URL.
 *
 * base64url's alphabet is `A-Z a-z 0-9 - _`, none of which mean anything to a
 * query-string parser, so there is nothing left to corrupt.
 */
export function pack(message: string): string {
  const bytes = new TextEncoder().encode(message);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unpack(packed: string): string {
  const b64 = packed.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
