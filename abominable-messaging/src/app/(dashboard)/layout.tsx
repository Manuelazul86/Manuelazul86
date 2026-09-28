import { AppShell } from "@/components/app/app-shell";
import { requireSessionContext } from "@/lib/auth";
import { isDangerousMockMode, isMockMode } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { email, organization } = await requireSessionContext();

  return (
    <AppShell
      email={email}
      organizationName={organization.name}
      timezone={organization.timezone}
      mockMode={isMockMode()}
      mockInProduction={isDangerousMockMode()}
    >
      {children}
    </AppShell>
  );
}
