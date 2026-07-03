"use client";
import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for the authenticated app shell. Unlike global-error, this
 * keeps the sidebar/layout intact and only replaces the page content — so a
 * failure in one route doesn't blank the whole workspace.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-boundary]", error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center px-6 py-20">
      <div className="max-w-sm text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-mono">
          This view
        </p>
        <h2 className="mt-3 font-display text-3xl italic">didn&apos;t load.</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Something in this page errored. The rest of your workspace is fine —
          try reloading just this view.
        </p>
        <Button onClick={reset} className="mt-6" size="sm">
          <RefreshCw className="h-3.5 w-3.5" /> Reload view
        </Button>
      </div>
    </div>
  );
}
