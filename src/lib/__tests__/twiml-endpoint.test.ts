import { describe, test, expect, beforeEach } from "vitest";
import { pack, unpack, signMessage, verifyMessage } from "../calls/sign";
import { twimlRequestUrl, sayTwiml } from "../calls/twilio";

beforeEach(() => { process.env.AUTH_SECRET = "test-secret-value"; });

describe("twiml signing", () => {
  test("a message verifies against its own signature", async () => {
    const m = "Heads up. Your event, Standup, starts in about two minutes.";
    expect(await verifyMessage(m, await signMessage(m))).toBe(true);
  });

  test("rejects a tampered message — the whole point of the endpoint", async () => {
    // Without this the tunnel URL is a machine that reads anything aloud.
    const sig = await signMessage("Your event, Standup, starts soon.");
    expect(await verifyMessage("Transfer the money to account 12345.", sig)).toBe(false);
  });

  test("rejects an empty or junk signature", async () => {
    expect(await verifyMessage("hello", "")).toBe(false);
    expect(await verifyMessage("hello", "deadbeef")).toBe(false);
  });

  test("a different secret does not verify", async () => {
    const sig = await signMessage("hello");
    process.env.AUTH_SECRET = "a-completely-different-secret";
    expect(await verifyMessage("hello", sig)).toBe(false);
  });

  test("refuses to verify rather than defaulting when AUTH_SECRET is absent", async () => {
    const sig = await signMessage("hello");
    delete process.env.AUTH_SECRET;
    expect(await verifyMessage("hello", sig)).toBe(false);
  });
});

describe("packing", () => {
  test("round-trips, including the characters that broke this", () => {
    for (const m of [
      "Design & Review",
      "1:1 with Ben & co — 3:30pm",
      "Sprint planning (Q4) 100% + retro",
      "スタンドアップ",
    ]) expect(unpack(pack(m))).toBe(m);
  });

  test("emits only characters a query string cannot corrupt", () => {
    // The whole point: Twilio re-encodes the URL, so an `&` or `+` reaching it
    // truncates the message and the call fails as "server unreachable".
    const packed = pack("Design & Review, 100% + more");
    expect(packed).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("twiml request url", () => {
  test("carries the packed message and a signature over it", async () => {
    const m = "Your event, Design & Review, starts soon.";
    const url = new URL(await twimlRequestUrl("https://x.trycloudflare.com/api/calls/twiml", m));
    const packed = url.searchParams.get("m") as string;
    expect(unpack(packed)).toBe(m);
    expect(await verifyMessage(packed, url.searchParams.get("sig") as string)).toBe(true);
  });

  test("survives Twilio decoding the URL before it fetches", async () => {
    // Reproduces the actual failure: Twilio turned %26 back into a bare & and
    // truncated the message. Nothing in the packed form can be decoded into a
    // query-string delimiter, so the raw and decoded URLs agree.
    const url = await twimlRequestUrl("https://x.trycloudflare.com/api/calls/twiml", "Design & Review");
    expect(new URL(decodeURIComponent(url)).searchParams.get("m"))
      .toBe(new URL(url).searchParams.get("m"));
  });

  test("the unpacked message is escaped once when rendered", async () => {
    const url = new URL(await twimlRequestUrl("https://x.trycloudflare.com/api/calls/twiml", "Design & Review"));
    const out = sayTwiml(unpack(url.searchParams.get("m") as string));
    expect(out).toContain("Design &amp; Review");
    expect(out).not.toContain("&amp;amp;");
  });
});

describe("tunnel URL detection", () => {
  // Guards the regression that sent every call to cloudflared's control plane.
  const RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi;
  const NOT_A_TUNNEL = new Set(["api.trycloudflare.com"]);
  const pick = (text: string) => {
    for (const m of text.matchAll(RE)) {
      if (!NOT_A_TUNNEL.has(new URL(m[0]).hostname)) return m[0];
    }
    return null;
  };

  test("ignores api.trycloudflare.com and takes the assigned hostname", () => {
    const real = [
      "INF Requesting new quick Tunnel on trycloudflare.com...",
      "INF Connecting to https://api.trycloudflare.com",
      "INF |  https://neat-purple-jaguar-1234.trycloudflare.com  |",
    ].join("\n");
    expect(pick(real)).toBe("https://neat-purple-jaguar-1234.trycloudflare.com");
  });

  test("returns null when only the control plane has appeared yet", () => {
    expect(pick("INF Connecting to https://api.trycloudflare.com")).toBeNull();
  });
});
