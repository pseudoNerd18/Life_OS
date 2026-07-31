"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * Renders the outcome of the Google OAuth redirect, then strips the query
 * params so a refresh doesn't replay the toast.
 */
export function CalendarConnectNotice({
  status,
  detail,
}: {
  status?: string;
  detail?: string;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!status) return;
    switch (status) {
      case "connected":
        toast.success(`Connected ${detail ?? "Google Calendar"}`, {
          description: "First sync complete.",
        });
        break;
      case "connected_nosync":
        toast.warning("Connected, but the first sync failed", { description: detail });
        break;
      case "denied":
        toast.info("Google Calendar was not connected", { description: "Access was declined." });
        break;
      case "unconfigured":
        toast.error("Google Calendar is not configured", {
          description: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        });
        break;
      default:
        toast.error("Could not connect Google Calendar", { description: detail });
    }
    router.replace("/calendar");
  }, [status, detail, router]);

  return null;
}
