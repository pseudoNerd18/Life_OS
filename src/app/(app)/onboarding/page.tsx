import { currentUser } from "@/lib/session";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/layout/onboarding-flow";

export default async function OnboardingPage() {
  const user = await currentUser();
  if (user.onboardedAt) redirect("/dashboard");

  return (
    <OnboardingFlow
      defaultName={user.name ?? ""}
      defaultTz={user.timezone ?? "Asia/Kolkata"}
    />
  );
}
