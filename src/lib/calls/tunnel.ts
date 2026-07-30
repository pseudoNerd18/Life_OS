/**
 * A public URL for the TwiML endpoint, via a cloudflared quick tunnel.
 *
 * Twilio has to fetch `/api/calls/twiml` over the internet, and this app runs on
 * localhost. On a Twilio trial there is no alternative: inline TwiML is
 * rejected, and a TwiML Bin cannot carry the event name because it refuses the
 * query string that would hold it.
 *
 * Quick tunnels need no Cloudflare account but hand out a different hostname
 * every run, so the URL is discovered at boot rather than configured. It is
 * published into `TWILIO_TWIML_URL`, which is where `twilioConfig()` already
 * looks — so a tunnel and a hand-set URL are the same thing to the caller, and
 * setting that variable yourself disables all of this.
 *
 * If anything here fails, reminder calls still go out; they just fall back to
 * ringing without naming the event.
 */
import type { ChildProcess } from "node:child_process";

const QUICK_TUNNEL_HOST = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi;
/**
 * cloudflared talks to `api.trycloudflare.com` on startup and prints it, so a
 * naive match picks up the control-plane endpoint instead of the tunnel that
 * was actually assigned — and every call then goes to a host that knows nothing
 * about us. Only the assigned hostname is a valid answer.
 */
const NOT_A_TUNNEL = new Set(["api.trycloudflare.com"]);
/** Generous: cloudflared prints its URL within a few seconds when healthy. */
const READY_TIMEOUT_MS = 45_000;

let child: ChildProcess | null = null;

export interface TunnelResult {
  url: string | null;
  reason?: string;
}

/**
 * Start the tunnel and resolve once its public URL is known.
 *
 * Never rejects — a missing binary or a Cloudflare outage must not take down
 * the server it is attached to.
 */
export async function startTunnel(port: number): Promise<TunnelResult> {
  if (child) return { url: process.env.TWILIO_TWIML_URL ?? null };

  // Loaded through an ignored dynamic import, not a static one. Next compiles
  // `instrumentation.ts` for the edge runtime as well as node, and webpack
  // cannot resolve `node:child_process` there — a static import fails the whole
  // app build, taking every route down with it, not just this file.
  let spawn: typeof import("node:child_process").spawn;
  try {
    ({ spawn } = await import(/* webpackIgnore: true */ "node:child_process"));
  } catch (err) {
    return { url: null, reason: err instanceof Error ? err.message : String(err) };
  }

  return new Promise<TunnelResult>((resolve) => {
    let settled = false;
    const done = (r: TunnelResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    let proc: ChildProcess;
    try {
      proc = spawn(
        "cloudflared",
        ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      return done({ url: null, reason: err instanceof Error ? err.message : String(err) });
    }
    child = proc;

    const timer = setTimeout(
      () => done({ url: null, reason: `no tunnel URL within ${READY_TIMEOUT_MS / 1000}s` }),
      READY_TIMEOUT_MS,
    );

    // cloudflared announces the URL on stderr, not stdout. Watch both rather
    // than relying on which stream a given version chooses.
    const scan = (buf: Buffer) => {
      const text = buf.toString();
      if (process.env.DEBUG_TUNNEL) process.stderr.write(`[cloudflared] ${text}`);
      for (const m of text.matchAll(QUICK_TUNNEL_HOST)) {
        if (!NOT_A_TUNNEL.has(new URL(m[0]).hostname)) return done({ url: m[0] });
      }
    };
    proc.stdout?.on("data", scan);
    proc.stderr?.on("data", scan);

    proc.on("error", (err) => done({ url: null, reason: err.message }));
    proc.on("exit", (code) => {
      child = null;
      done({ url: null, reason: `cloudflared exited with code ${code}` });
    });

    // Don't keep the process alive on the tunnel's account.
    proc.unref();
  });
}

export function stopTunnel() {
  child?.kill();
  child = null;
}
