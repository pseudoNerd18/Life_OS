/**
 * `callbackUrl` reaches the login pages straight from the query string, so it
 * has to be treated as untrusted input: echoing an absolute URL back into a
 * redirect would turn the sign-in page into an open redirect that sends people
 * to an attacker's site wearing our domain in the referrer.
 *
 * Only same-site, absolute-path destinations survive. `//evil.com` is rejected
 * too — browsers read a protocol-relative URL as a different host.
 */
export function safeCallback(raw: string | undefined | null): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}
