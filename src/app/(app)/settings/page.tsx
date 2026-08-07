import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getCapabilities } from "@/lib/env";
import { googleClientId } from "@/lib/auth/google-id-token";
import { SettingsContent } from "@/components/layout/settings-content";

export default async function SettingsPage() {
  const user = await currentUser();
  const accounts = await prisma.calendarAccount.findMany({ where: { userId: user.id } });
  const caps = getCapabilities();

  return (
    <SettingsContent
      user={{
        email: user.email,
        name: user.name,
        image: user.image,
        timezone: user.timezone,
      }}
      googleConfigured={caps.hasGoogleCalendar}
      googleClientId={googleClientId()}
      calendarAccounts={accounts.map((a: { id: string; provider: string; email: string; lastSyncedAt: Date | null; isActive: boolean; refreshToken: string | null; expiresAt: Date }) => ({
        id: a.id,
        provider: a.provider,
        email: a.email,
        lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
        isActive: a.isActive,
        sessionOnly: !a.refreshToken,
        expiresAt: a.expiresAt.toISOString(),
      }))}
    />
  );
}
