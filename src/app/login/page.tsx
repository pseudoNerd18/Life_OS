import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthForm } from "@/components/auth/auth-form";
import { safeCallback } from "@/lib/auth-redirect";
import { googleClientId, mintNonce } from "@/lib/auth/google-id-token";

/**
 * Rendered per request: each load mints a fresh sign-in nonce, so a cached
 * page would hand every visitor the same one.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · Life OS" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  // Already signed in — no reason to show a login form.
  if ((await auth())?.user) redirect("/dashboard");

  const { callbackUrl, error } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <AuthForm mode="login"
        callbackUrl={safeCallback(callbackUrl)}
        error={error}
        googleClientId={googleClientId()}
        googleNonce={await mintNonce()}
      />
    </main>
  );
}

