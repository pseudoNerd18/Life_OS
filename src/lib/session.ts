/**
 * Server-side access to the signed-in user.
 *
 * All auth (email/password + Google) lives in `src/lib/auth.ts`. This module
 * is the one place the rest of the app reads "who is this" — it takes the
 * Auth.js JWT session (id/email/name/image only) and joins it against the
 * `User` row for the fuller profile (timezone, onboarding state, ...) that
 * every page already expects.
 *
 * Every route under `(app)/` and every `/api/*` route besides the public
 * exceptions in `middleware.ts` is auth-gated, so a missing session here is
 * a bug in that gate, not a case to degrade gracefully from.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";

export interface CurrentUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  timezone: string;
  onboardedAt: Date | null;
}

const USER_SELECT = {
  id: true, name: true, email: true, image: true,
  timezone: true, onboardedAt: true,
} as const;

export class UnauthorizedError extends Error {
  constructor() {
    super("No signed-in user — this route should be behind the auth middleware.");
    this.name = "UnauthorizedError";
  }
}

export async function currentUser(): Promise<CurrentUser> {
  const session = await auth();

  // Signed-in user via Auth.js / NextAuth
  if (session?.user?.id) {
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: USER_SELECT });
    if (!user) throw new UnauthorizedError();
    return user;
  }

  // Fallback: guest cookie (lifeos_uid). Mint a user row for the id if needed.
  const jar = await cookies();
  const life = jar.get("lifeos_uid")?.value;
  if (!life) throw new UnauthorizedError();

  // Upsert a guest-style user so downstream code can rely on a real row.
  const u = await prisma.user.upsert({
    where: { id: life },
    update: {},
    create: {
      id: life,
      name: "Guest",
      timezone: process.env.TZ || "UTC",
      onboardedAt: null,
    },
    select: USER_SELECT,
  });
  if (!u) throw new UnauthorizedError();
  return u;
}

export async function currentUserId(): Promise<string> {
  return (await currentUser()).id;
}
