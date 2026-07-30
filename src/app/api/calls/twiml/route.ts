/**
 * The TwiML Twilio fetches when placing a reminder call.
 *
 * Exists because a Twilio trial account cannot send inline TwiML, and a TwiML
 * Bin — the obvious alternative — rejects the query string that would carry the
 * event name, so it can only ever say something fixed. A URL of our own is the
 * only way to speak the actual event on a trial.
 *
 * Public by necessity (see `middleware.ts`), so every request must carry a
 * signature over the message. See `lib/calls/sign.ts`.
 *
 * Twilio issues this as a POST by default and follows redirects poorly, so both
 * verbs are handled and neither reads a body.
 */
import { NextResponse } from "next/server";
import { unpack, verifyMessage } from "@/lib/calls/sign";
import { sayTwiml } from "@/lib/calls/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function render(req: Request) {
  const url = new URL(req.url);
  const packed = url.searchParams.get("m") ?? "";
  const signature = url.searchParams.get("sig") ?? "";

  if (!packed || !(await verifyMessage(packed, signature))) {
    // Deliberately says nothing rather than explaining itself: this endpoint is
    // world-reachable, and a spoken error would make it a free megaphone.
    return new NextResponse("<Response/>", {
      status: 403,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  }

  let message: string;
  try {
    message = unpack(packed);
  } catch {
    return new NextResponse("<Response/>", {
      status: 400,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  }

  return new NextResponse(sayTwiml(message), {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      // Two calls a minute apart must not get one cached answer.
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: Request) { return render(req); }
export async function POST(req: Request) { return render(req); }
