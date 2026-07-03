import { currentUser } from "@/lib/session";
import { getCapabilities } from "@/lib/env";
import { Sidebar } from "@/components/layout/sidebar";
import { DiagnosticsBanner } from "@/components/layout/diagnostics-banner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const caps = getCapabilities();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar user={user} />
      <main className="flex-1 min-w-0 flex flex-col">
        <DiagnosticsBanner notes={caps.notes} />
        {children}
      </main>
    </div>
  );
}
