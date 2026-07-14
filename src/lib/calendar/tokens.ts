/**
 * Access-token lifecycle for linked calendar accounts.
 *
 * Google access tokens live ~1 hour; refresh tokens are long-lived. Every
 * outbound API call goes through `getValidAccessToken`, which refreshes and
 * persists on the way through so a single sync run never dies halfway with a
 * 401.
 */
import { prisma } from "@/lib/db";
import { googleConfig, refreshAccessToken } from "@/lib/calendar/google";

export interface AccountRow {
  id: string;
  userId: string;
  provider: string;
  email: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
  calendarId: string | null;
  syncToken: string | null;
  lastSyncedAt: Date | null;
  isActive: boolean;
}

/** Raised when an account can no longer be refreshed and needs re-linking. */
export class ReauthRequired extends Error {
  readonly accountId: string;
  constructor(accountId: string, detail: string) {
    super(`Calendar account needs to be reconnected: ${detail}`);
    this.name = "ReauthRequired";
    this.accountId = accountId;
  }
}

export async function getValidAccessToken(account: AccountRow): Promise<string> {
  // Refresh a minute early rather than racing the expiry.
  if (account.expiresAt.getTime() > Date.now() + 60_000) return account.accessToken;

  const cfg = googleConfig();
  if (!cfg) throw new ReauthRequired(account.id, "Google credentials are not configured");
  // A session-token account (browser-granted, no client secret) has nothing to
  // refresh with. Expiry is the end of it — the user must grant again.
  if (!account.refreshToken) {
    throw new ReauthRequired(account.id, "this calendar was connected for a single session");
  }

  let tokens;
  try {
    tokens = await refreshAccessToken(cfg, account.refreshToken);
  } catch (err) {
    const msg = (err as Error).message;
    // `invalid_grant` means the refresh token was revoked or expired — the user
    // must re-consent. Deactivate so the UI can prompt instead of silently
    // failing on every subsequent sync.
    if (/invalid_grant/i.test(msg)) {
      await prisma.calendarAccount
        .update({ where: { id: account.id }, data: { isActive: false } })
        .catch(() => {});
      throw new ReauthRequired(account.id, "Google rejected the refresh token");
    }
    throw err;
  }

  // Google usually omits refresh_token on a refresh response — keep the old one.
  await prisma.calendarAccount.update({
    where: { id: account.id },
    data: {
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
    },
  });

  account.accessToken = tokens.accessToken;
  account.expiresAt = tokens.expiresAt;
  return tokens.accessToken;
}
