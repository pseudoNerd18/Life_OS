/**
 * Loads Google Identity Services on demand.
 *
 * Previously the `<script>` lived inside the sign-in button, so anything else
 * that needed GIS — the calendar grant in Settings, for instance — found
 * `window.google` undefined and failed with a misleading "could not reach
 * Google". Owning the load here means every consumer works wherever it renders,
 * and the script is fetched at most once per page.
 */
const GSI_SRC = "https://accounts.google.com/gsi/client";

let pending: Promise<boolean> | null = null;

/** Resolves true once `window.google.accounts` is usable, false if it can't load. */
export function loadGsi(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.google?.accounts) return Promise.resolve(true);
  if (pending) return pending;

  pending = new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => {
      // A failed load must not be cached: the network may recover, and the user
      // can reasonably click the button again.
      if (!ok) pending = null;
      resolve(ok);
    };

    // The tag may already be present from another component or a prior mount.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      if (window.google?.accounts) return done(true);
      existing.addEventListener("load", () => done(!!window.google?.accounts), { once: true });
      existing.addEventListener("error", () => done(false), { once: true });
      return;
    }

    const el = document.createElement("script");
    el.src = GSI_SRC;
    el.async = true;
    el.defer = true;
    el.addEventListener("load", () => done(!!window.google?.accounts), { once: true });
    el.addEventListener("error", () => done(false), { once: true });
    document.head.appendChild(el);
  });

  return pending;
}
