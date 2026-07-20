import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { syncUser } from "@/lib/calendar/sync";
import { safeTz } from "@/lib/time";
import { rateLimitFor } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

/** Manual "Sync now". Google's quotas are generous but a hammered button isn't. */
export async function POST(req: Request) {
  const user = await currentUser();

  const rl = await rateLimitFor("calendarSync", user.id);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many sync requests — try again in a moment." },
      { status: 429 },
    );
  }

  void req;
  try {
    const { reports, errors } = await syncUser(user.id, safeTz(user.timezone));
    if (!reports.length && !errors.length) {
      return NextResponse.json({ error: "No calendar connected." }, { status: 400 });
    }
    return NextResponse.json({ reports, errors });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
