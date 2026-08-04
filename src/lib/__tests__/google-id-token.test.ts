import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { mintNonce, verifyNonce } from "../auth/google-id-token";

/**
 * These cover the nonce, which is pure and local. The full `verifyGoogleIdToken`
 * path fetches Google's live JWKS, so its signature check can't be exercised
 * with a locally-signed token — what IS exercised here is every rejection rule
 * that guards it, since those are the ones that would silently let a forged or
 * replayed token through.
 */
beforeAll(() => {
  process.env.AUTH_SECRET ||= "test-secret-for-nonce-signing-only";
});

/** Mirrors the implementation's signing so tests can forge candidate nonces. */
async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  let out = "";
  for (const b of sig) out += String.fromCharCode(b);
  return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("sign-in nonce", () => {
  it("accepts a freshly minted nonce", async () => {
    expect(await verifyNonce(await mintNonce())).toBe(true);
  });

  it("mints a different nonce every time", async () => {
    const seen = new Set(await Promise.all(Array.from({ length: 50 }, () => mintNonce())));
    expect(seen.size).toBe(50);
  });

  it("rejects a nonce that was never minted here", async () => {
    expect(await verifyNonce("made.up.value")).toBe(false);
  });

  it("rejects absent and malformed shapes", async () => {
    for (const v of [null, undefined, "", "one", "one.two", "a.b.c.d"]) {
      expect(await verifyNonce(v)).toBe(false);
    }
  });

  it("rejects a tampered random part, even with the original signature", async () => {
    const [rand, exp, mac] = (await mintNonce()).split(".");
    expect(await verifyNonce(`${rand}x.${exp}.${mac}`)).toBe(false);
  });

  it("rejects an extended expiry — the HMAC covers it", async () => {
    const [rand, , mac] = (await mintNonce()).split(".");
    const farFuture = Date.now() + 10 * 365 * 24 * 3600_000;
    expect(await verifyNonce(`${rand}.${farFuture}.${mac}`)).toBe(false);
  });

  it("rejects an already-expired nonce it did sign", async () => {
    // Re-signed with a past expiry using the real secret, so this proves expiry
    // is enforced independently of the signature being valid.
    const body = `abc.${Date.now() - 1000}`;
    expect(await verifyNonce(`${body}.${await hmac(body, process.env.AUTH_SECRET!)}`)).toBe(false);
  });

  it("rejects a nonce signed with a different secret", async () => {
    const body = `abc.${Date.now() + 60_000}`;
    expect(await verifyNonce(`${body}.${await hmac(body, "some-other-secret")}`)).toBe(false);
  });
});

/**
 * A forged token is the attack that matters: anyone can mint a JWT claiming to
 * be any email. It must fail because it isn't signed by Google.
 */
describe("forged ID tokens", () => {
  let key: CryptoKey;
  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    key = pair.privateKey;
    // Sanity: our fake key is a real RSA key, just not Google's.
    expect(await exportJWK(pair.publicKey)).toHaveProperty("n");
  });

  it("a self-signed token claiming a victim's email is rejected", async () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "test.apps.googleusercontent.com";
    const nonce = await mintNonce();
    const forged = await new SignJWT({
      email: "victim@example.com",
      email_verified: true,
      nonce,
      name: "Not The Victim",
    })
      .setProtectedHeader({ alg: "RS256", kid: "not-a-google-key" })
      .setIssuer("https://accounts.google.com")
      .setAudience("test.apps.googleusercontent.com")
      .setSubject("999")
      .setExpirationTime("5m")
      .sign(key);

    const { verifyGoogleIdToken } = await import("../auth/google-id-token");
    await expect(verifyGoogleIdToken(forged, nonce)).rejects.toThrow();
  });

  it("a bad nonce is refused before Google is ever contacted", async () => {
    const { verifyGoogleIdToken } = await import("../auth/google-id-token");
    await expect(verifyGoogleIdToken("whatever", "forged.nonce.value")).rejects.toThrow(
      /nonce is invalid or expired/,
    );
  });
});
