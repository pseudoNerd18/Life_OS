/**
 * Which Google grants are good enough for two-way calendar sync.
 *
 * Sign-in no longer produces calendar tokens — it uses a Google Identity
 * Services ID token, which proves identity and grants no API access. Calendar
 * access is obtained separately by `/api/calendar/google/connect`, and this is
 * the check that flow applies to whatever scopes come back, since Google's
 * granular consent lets a user approve some and refuse others.
 */
import { CALENDAR_SCOPE } from "@/lib/calendar/google";

/** True when the user actually left calendar access ticked on the consent screen. */
export function grantedCalendarAccess(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).includes(CALENDAR_SCOPE);
}
