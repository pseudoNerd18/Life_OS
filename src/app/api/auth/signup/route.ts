import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

const signupZ = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(120).optional(),
});

/**
 * Creates an account. Auth.js has no built-in registration endpoint for the
 * Credentials provider — this is that missing piece. Signs nothing in
 * itself; the client follows up with `signIn("credentials", ...)`.
 */
export async function POST(req: Request) {
  const rl = await rateLimit(`signup:${req.headers.get("x-forwarded-for") ?? "unknown"}`);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts — try again in a moment." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = signupZ.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { email, password, name } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Same message whether the account exists via password or Google-only,
    // so this endpoint can't be used to enumerate which is true.
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: { email, passwordHash, name: name ?? null },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
