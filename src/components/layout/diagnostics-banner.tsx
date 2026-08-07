"use client";
import { useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Non-blocking diagnostics strip. Rendered at the top of the app shell only
 * when the server reports a degraded capability (e.g. in-memory mode because
 * DATABASE_URL is unset). Dismissible — never nags.
 *
 * This is the calm, honest alternative to a crash: the app works, and the
 * user is told exactly what's limited and how to fix it.
 */
export function DiagnosticsBanner({ notes }: { notes: string[] }) {
  const [open, setOpen] = useState(true);
  if (!notes.length) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden border-b border-amber-500/20 bg-amber-50/60 dark:bg-amber-950/20"
        >
          <div className="px-6 py-2.5 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" strokeWidth={1.75} />
            <div className="flex-1 min-w-0 text-xs text-amber-900/80 dark:text-amber-200/80 space-y-0.5">
              {notes.map((n, i) => (
                <p key={i} className="leading-relaxed">{n}</p>
              ))}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-amber-700/60 dark:text-amber-500/60 hover:text-amber-900 dark:hover:text-amber-300 transition-colors shrink-0"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
