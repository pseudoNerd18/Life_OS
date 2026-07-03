"use client";
import { useEffect } from "react";
import { RefreshCw, Home } from "lucide-react";

/**
 * App-level error boundary. Replaces the raw Next.js error overlay in
 * production with a calm, branded recovery screen.
 *
 * In dev, Next still shows its overlay too — that's intentional and useful.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[boundary] uncaught error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "hsl(40 22% 98%)",
            color: "hsl(30 8% 14%)",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            padding: "2rem",
          }}
        >
          <div style={{ maxWidth: "26rem", textAlign: "center" }}>
            <p
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                color: "hsl(30 5% 45%)",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              Unexpected error
            </p>
            <h1
              style={{
                fontFamily: "Georgia, serif",
                fontStyle: "italic",
                fontSize: "2.25rem",
                margin: "0.75rem 0 0",
                lineHeight: 1.1,
              }}
            >
              Something slipped.
            </h1>
            <p style={{ color: "hsl(30 5% 45%)", fontSize: "0.9rem", marginTop: "0.75rem" }}>
              The workspace hit a snag. Your local data is intact — this is just
              the view. Try again, or head back home.
            </p>
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                justifyContent: "center",
                marginTop: "1.75rem",
              }}
            >
              <button
                onClick={reset}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  background: "hsl(30 8% 14%)",
                  color: "hsl(40 22% 98%)",
                  border: "none",
                  borderRadius: "999px",
                  padding: "0.6rem 1.25rem",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                <RefreshCw size={14} /> Try again
              </button>
              {/* A plain anchor on purpose: global-error replaces the root
                  layout, so the App Router context <Link> depends on may not be
                  mounted. A full document navigation is the reliable escape. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  border: "1px solid hsl(30 8% 90%)",
                  color: "hsl(30 8% 14%)",
                  borderRadius: "999px",
                  padding: "0.6rem 1.25rem",
                  fontSize: "0.85rem",
                  textDecoration: "none",
                }}
              >
                <Home size={14} /> Home
              </a>
            </div>
            {error.digest && (
              <p
                style={{
                  marginTop: "1.5rem",
                  fontSize: "0.7rem",
                  color: "hsl(30 5% 60%)",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                ref: {error.digest}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
