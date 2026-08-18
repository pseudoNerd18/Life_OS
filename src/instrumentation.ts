/**
 * Server boot hook (https://nextjs.org/docs/app/guides/instrumentation).
 *
 * The reminder calls need something ticking in the background, and this app has
 * no job queue or cron. For a single-instance, self-hosted deployment an
 * interval in the server process is the honest fit: it starts with `npm run
 * dev`, needs no external scheduler, and dies with the process. If this ever
 * runs on more than one instance, move the body of `tick` behind an authorised
 * route and drive it from a real scheduler — `runDueReminders` claims each
 * event in the database first, so it is already safe to call concurrently.
 */

/** One minute. The sweep's own slack window absorbs the resulting jitter. */
const TICK_MS = 60_000;

export async function register() {
  // `register` also runs in the edge runtime, where there is no Prisma client
  // and no reason to schedule anything.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Next re-runs `register` on hot reload in dev; without this the intervals
  // stack up and you get one call per surviving timer.
  const g = globalThis as { __lifeosReminderTimer?: NodeJS.Timeout };
  if (g.__lifeosReminderTimer) return;

  const { runDueReminders } = await import("@/lib/calls/reminders");

  // Give Twilio a public URL for the TwiML endpoint before the first sweep.
  //
  // Only when Twilio is configured but no TwiML URL is: a hand-set
  // TWILIO_TWIML_URL means someone has already solved this a better way, and
  // spending 45s on a tunnel nobody will use would delay every boot.
  if (
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
    process.env.TWILIO_AUTH_TOKEN?.trim() &&
    !process.env.TWILIO_TWIML_URL?.trim()
  ) {
    const { startTunnel } = await import("@/lib/calls/tunnel");
    const port = Number(process.env.PORT ?? 3010);
    const { url, reason } = await startTunnel(port);
    if (url) {
      // twilioConfig() reads this on every call, so publishing it here is all
      // the wiring the rest of the code needs.
      process.env.TWILIO_TWIML_URL = `${url}/api/calls/twiml`;
      console.info(`[reminders] tunnel up — calls will name the event (${url})`);
    } else {
      console.warn(
        `[reminders] no tunnel (${reason}) — calls will still ring, but without ` +
        "naming the event. Is cloudflared installed?",
      );
    }
  }

  let warnedUnconfigured = false;

  const tick = async () => {
    try {
      const result = await runDueReminders();
      if (result.skipped === "no-twilio") {
        // Say it once, not sixty times an hour. Not having a phone line
        // configured is the normal state, not an error.
        if (!warnedUnconfigured) {
          warnedUnconfigured = true;
          console.info(
            "[reminders] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER not set — " +
            "reminder calls are off. See .env.example.",
          );
        }
        return;
      }
      warnedUnconfigured = false;
      for (const id of result.called) {
        console.info(`[reminders] called about event ${id}`);
      }
      if (result.generic.length > 0) {
        // Said once per sweep, not once per call: the cause is the account, not
        // the event, and the fix is the same for all of them.
        console.warn(
          `[reminders] ${result.generic.length} call(s) rang without naming the event — ` +
          "a Twilio trial account cannot send custom TwiML. Upgrade the account to " +
          "restore the spoken reminder; no code change needed.",
        );
      }
      for (const f of result.failed) console.error(`[reminders] event ${f.eventId}: ${f.error}`);
    } catch (err) {
      // A throw here would take down the interval and silently end all future
      // reminders — the one failure mode worth swallowing.
      console.error("[reminders] sweep failed:", err);
    }
  };

  const timer = setInterval(tick, TICK_MS);
  // Don't hold the process open on its own account.
  timer.unref?.();
  g.__lifeosReminderTimer = timer;

  void tick();
}
