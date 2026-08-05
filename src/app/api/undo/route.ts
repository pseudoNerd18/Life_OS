import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { restoreEntity, type DeletedSnapshot } from "@/lib/server/actions";
import { z } from "zod";

export const runtime = "nodejs";

/**
 * Restore something a voice command deleted.
 *
 * Dictation mishears — "Remind" becomes "Find", "4 PM" becomes "4 AM" — and in
 * hands-free mode nobody confirms before it runs. A delete you can't take back
 * would make voice deletion irresponsible to ship, so the delete hands the
 * client a snapshot and this puts it back.
 *
 * The snapshot round-trips through the client, so it is untrusted input: it is
 * re-validated here and written under the *session's* user id, never one
 * supplied in the body.
 */
const bodyZ = z.object({
  snapshot: z.object({
    kind: z.enum(["task", "note", "goal"]),
    title: z.string(),
    data: z.record(z.unknown()),
  }),
});

export async function POST(req: Request) {
  const user = await currentUser();

  const body = await req.json().catch(() => null);
  const parsed = bodyZ.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await restoreEntity(user.id, parsed.data.snapshot as DeletedSnapshot);
  if (!result.ok) {
    return NextResponse.json({ error: "Could not restore that." }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    id: result.id,
    kind: parsed.data.snapshot.kind,
    title: parsed.data.snapshot.title,
  });
}
