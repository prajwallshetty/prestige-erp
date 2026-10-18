import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        branchName: user.branchName,
        firmName: user.activeFirmName ?? user.firmName,
        permissions: user.permissions,
      }}
    >
      {children}
    </AppShell>
  );
}
