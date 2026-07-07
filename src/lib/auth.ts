/**
 * Auth.js (NextAuth v5) configuration.
 *
 * Two ways in, both modelled as Credentials providers:
 *   · `google`      — a Google Identity Services ID token, verified against
 *                     Google's public keys (see `lib/auth/google-id-token.ts`)
 *   · `credentials` — email + password, checked against `User.passwordHash`
 *
 * No client secret is involved anywhere, and no OAuth redirect: this app is
 * deliberately deployable with nothing secret on disk beyond `AUTH_SECRET`.
 * The cost is that sign-in yields identity only — obtaining API access to a
 * user's calendar needs the authorization-code flow, which is why that lives
 * separately in `/api/calendar/google/connect` and requires a secret.
 *
 * Credentials providers force the JWT session strategy, so there are no
 * `Session` rows and no Prisma adapter: user records are created and looked up
 * directly in `authorize()`.
 *
 * Every `authorize()` returns `null` rather than throwing on bad input, a
 * missing user, an OAuth-only account, or a wrong password — Auth.js turns that
 * into a generic "invalid credentials" instead of leaking which part failed.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { verifyGoogleIdToken } from "@/lib/auth/google-id-token";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    /**
     * Google, via Google Identity Services.
     *
     * Modelled as a Credentials provider rather than Auth.js's OAuth Google
     * provider because the OAuth flow needs a client secret and this app keeps
     * none: GIS gives the browser a signed ID token, and verifying it takes
     * only Google's public keys plus our public client ID. See
     * `lib/auth/google-id-token.ts`.
     *
     * Consequence worth knowing: an ID token is proof of identity, not an API
     * grant. It cannot be exchanged for calendar access — that still goes
     * through `/api/calendar/google/connect`, which does require a secret.
     */
    Credentials({
      id: "google",
      name: "Google",
      credentials: {
        credential: { label: "Google ID token", type: "text" },
        nonce: { label: "Nonce", type: "text" },
      },
      async authorize(creds) {
        const credential = typeof creds?.credential === "string" ? creds.credential : null;
        const nonce = typeof creds?.nonce === "string" ? creds.nonce : null;
        if (!credential || !nonce) return null;

        let identity;
        try {
          identity = await verifyGoogleIdToken(credential, nonce);
        } catch (err) {
          // Log the specific reason; hand the user a generic failure.
          console.error("[auth] Google ID token rejected:", (err as Error).message);
          return null;
        }

        // Match on the verified email so a Google sign-in lands on the same
        // account as an existing password login rather than forking a second
        // one. `verifyGoogleIdToken` refuses unverified emails, without which
        // this lookup would be spoofable.
        const existing = await prisma.user.findUnique({ where: { email: identity.email } });
        if (existing) {
          // Fill in a name/avatar we didn't have, but never overwrite one the
          // user has already set here.
          const patch: { name?: string; image?: string } = {};
          if (!existing.name && identity.name) patch.name = identity.name;
          if (!existing.image && identity.picture) patch.image = identity.picture;
          const user = Object.keys(patch).length
            ? await prisma.user.update({ where: { id: existing.id }, data: patch })
            : existing;
          return { id: user.id, email: user.email, name: user.name, image: user.image };
        }

        const created = await prisma.user.create({
          data: {
            email: identity.email,
            name: identity.name,
            image: identity.picture,
            timezone: process.env.TZ || "UTC",
          },
        });
        return { id: created.id, email: created.email, name: created.name, image: created.image };
      },
    }),

    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        const email = typeof creds?.email === "string" ? creds.email.trim().toLowerCase() : null;
        const password = typeof creds?.password === "string" ? creds.password : null;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        // No account, or one created via Google only (no password set).
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    // Carry the user id from the initial sign-in onto the JWT, then onto
    // every session read — `session.user.id` doesn't exist by default.
    async jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
});
