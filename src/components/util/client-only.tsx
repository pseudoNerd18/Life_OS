"use client";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Returns false during SSR and the first client render, true thereafter.
 *
 * The canonical fix for "Hydration failed" when a component's output depends
 * on anything the server can't know: viewport, IntersectionObserver, spring
 * physics, `window`, media queries, etc.
 *
 * Pattern: render a deterministic placeholder until mounted, then the real
 * interactive thing.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/**
 * Renders `children` only after mount. Until then renders `fallback` (default:
 * nothing). Use this to wrap any subtree that would otherwise diverge between
 * server and client.
 *
 * The `fallback` should be visually close to the mounted state to avoid layout
 * shift — usually a static, non-animated version of the same content.
 */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const mounted = useMounted();
  return <>{mounted ? children : fallback}</>;
}
