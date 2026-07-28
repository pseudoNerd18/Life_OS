/**
 * Twilio outbound voice — the one place this app dials a phone.
 *
 * Ported from the call feature in magic-teams
 * (`apps/JENNY/app/api/twilio/call/route.ts`), which POSTs to the REST
 * `Calls.json` resource with an inline `Twiml` document. That app hands Twilio
 * a `<Connect><Stream>` pointing at an Ultravox agent so the callee can hold a
 * conversation; a reminder has nothing to listen for, so we send `<Say>` and
 * hang up. Same transport, no second vendor and no public websocket to expose.
 *
 * Credentials come from the environment rather than per-user rows: this is a
 * single-tenant, self-hosted app, and `lib/env.ts` already treats configuration
 * as a capability report instead of a hard requirement.
 */

import { pack, signMessage } from "@/lib/calls/sign";

const CALLS_ENDPOINT = (sid: string) =>
  `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`;

/**
 * Fallback for trial accounts, which may not send their own TwiML.
 *
 * A trial may set only `To`, `StatusCallback`, and one of four Twilio-hosted
 * template URLs (https://www.twilio.com/docs/usage/trials/try-out-voice) — the
 * `Twiml` parameter is rejected outright, and so is a TwiML Bin of your own.
 * The templates speak Twilio's own text and ignore any message we attach, so
 * this rings the phone without naming the event.
 *
 * That is still worth doing: the ring two minutes before the event is most of
 * the reminder, and the alternative is no call at all. Upgrading the Twilio
 * account restores the spoken event name with no code change.
 */
const TRIAL_TEMPLATE_URL =
  "https://webhooks.twilio.com/v1/Voice/Template/voice_text_to_speech";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  /**
   * A URL that returns TwiML, given the spoken text as a `Message` query
   * parameter. Optional, and the only way to name the event on a trial account.
   *
   * Trial accounts reject the inline `Twiml` parameter but — contrary to
   * Twilio's own trial documentation, which says only four fixed template URLs
   * are permitted — they *do* accept an arbitrary `Url`. Verified empirically
   * against a live trial account: `Url=https://example.com/...` returned 201.
   *
   * Point this at a TwiML Bin containing `<Response><Say>{{Message}}</Say></Response>`.
   * Bins are Twilio-hosted, so this works from localhost with no tunnel.
   */
  twimlUrl?: string;
}

/**
 * Read Twilio settings, or null when the app isn't configured to call.
 *
 * Read fresh each time rather than at module load: `lib/env.ts` memoises its
 * capability report, and a call that dials a real phone should not be gated by
 * a value cached before the process finished reading `.env`.
 */
export function twilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();
  const twimlUrl = process.env.TWILIO_TWIML_URL?.trim() || undefined;
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber, twimlUrl };
}

/**
 * Escape text for inclusion in a TwiML document.
 *
 * Event titles are user- and Google-supplied, and they land inside XML we build
 * by hand. An unescaped `&` or `<` makes Twilio reject the whole document, so
 * the call silently fails on exactly the events with the most interesting names.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Wrap a spoken message in TwiML.
 *
 * The message is said twice with a pause between. People answer a phone
 * mid-greeting, so a single pass is routinely half-heard, and the call is short
 * enough that the repeat costs nothing.
 */
export function sayTwiml(message: string): string {
  const said = `<Say voice="Polly.Joanna">${escapeXml(message)}</Say>`;
  return `<Response>${said}<Pause length="1"/>${said}</Response>`;
}

export interface PlacedCall {
  sid: string;
  status: string;
  /**
   * False when the account could not send custom TwiML and we fell back to a
   * Twilio template, so the phone rang but the event was never named.
   */
  spokenMessage: boolean;
}

/**
 * Dial `to` and speak `message`. Throws on any non-2xx from Twilio.
 *
 * Callers are responsible for not calling twice — see `reminders.ts`, which
 * claims an event in the database before it gets here.
 *
 * A trial account cannot send custom TwiML, so a rejection on those grounds is
 * retried once against a Twilio template. The returned `spokenMessage` says
 * which happened; everything else about the call is identical.
 */
export async function placeCall(
  to: string,
  message: string,
  config: TwilioConfig,
): Promise<PlacedCall> {
  const attempt = async (instructions: Record<string, string>) => {
    const authorization = Buffer.from(
      `${config.accountSid}:${config.authToken}`,
    ).toString("base64");

    const res = await fetch(CALLS_ENDPOINT(config.accountSid), {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        ...instructions,
        From: config.fromNumber,
        To: to,
      }).toString(),
    });
    return res;
  };

  // A hosted TwiML URL is preferred when configured: it is the only form that
  // speaks the real message on a trial account, and it works on a full account
  // too, so there is no reason to branch on which kind of account this is.
  //
  // The message goes over RAW, not XML-escaped: a bin renders `{{Message}}`
  // through Mustache, which escapes for us. Escaping here as well would put a
  // literal "&amp;" into the spoken text.
  let res = config.twimlUrl
    ? await attempt({ Url: await twimlRequestUrl(config.twimlUrl, message) })
    : await attempt({ Twiml: sayTwiml(message) });
  let spokenMessage = true;

  if (!res.ok) {
    const firstError = await describeError(res);
    // A configured TwiML URL is accepted by trials too, so a failure there is
    // a real fault (bad URL, bin deleted) and must not be masked by a retry
    // that silently downgrades every future call to a generic ring.
    if (config.twimlUrl || !isTrialRestriction(res.status, firstError)) {
      throw new Error(`Twilio call failed (${res.status}): ${firstError}`);
    }
    // Custom TwiML is off the table on this account. Ring anyway.
    res = await attempt({ Url: TRIAL_TEMPLATE_URL });
    spokenMessage = false;
    if (!res.ok) {
      throw new Error(`Twilio call failed (${res.status}): ${await describeError(res)}`);
    }
  }

  const data = (await res.json()) as { sid?: string; status?: string };
  return { sid: data.sid ?? "", status: data.status ?? "unknown", spokenMessage };
}

/**
 * Build the URL Twilio will fetch: the message plus a signature over it.
 *
 * The message is not XML-escaped here — `sayTwiml`, on the other side of the
 * round trip, does that when it renders. Escaping twice would have the call say
 * "Design &amp;amp; Review" out loud.
 */
export async function twimlRequestUrl(base: string, message: string): Promise<string> {
  const url = new URL(base);
  // Packed, not raw: Twilio re-encodes the URL and would corrupt any `&` in it.
  const packed = pack(message);
  url.searchParams.set("m", packed);
  url.searchParams.set("sig", await signMessage(packed));
  return url.toString();
}

/**
 * Twilio's error body is JSON with a `message` and a `code`. Surface those
 * rather than the status alone: "21215 not authorised to call this number" and
 * "20003 bad credentials" need very different fixes.
 */
async function describeError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { message?: string; code?: number };
    if (json.message) return `${json.message}${json.code ? ` (code ${json.code})` : ""}`;
  } catch {
    // Not JSON — the raw body is the best we have.
  }
  return text;
}

/**
 * Is this the "trial accounts have limited parameter access" rejection?
 *
 * Matched on the message text rather than a numeric code, because the text is
 * what Twilio actually returned when this was tested against a trial account
 * and the accompanying code was not documented. Narrow enough not to swallow
 * an unrelated 400: a wrong `From`, an unverified `To` and bad credentials all
 * report differently and still throw.
 */
function isTrialRestriction(status: number, error: string): boolean {
  return status === 400 && /\btrial\b/i.test(error);
}
