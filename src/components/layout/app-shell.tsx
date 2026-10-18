"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { BottomNav } from "@/components/layout/bottom-nav";
import type { PermissionCode } from "@/lib/rbac";
import type { UserRole } from "@/generated/prisma/enums";

interface AppShellProps {
  user: {
    name: string;
    email: string;
    role: UserRole;
    branchName: string | null;
    firmName: string | null;
    permissions: PermissionCode[];
  };
  children: ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-dvh bg-background">
      <div className="no-print">
        <Sidebar
          permissions={user.permissions}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          user={user}
        />
      </div>
      <div className="lg:pl-[272px] print:pl-0">
        <div className="no-print mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5 sm:pt-4">
          <Topbar
            name={user.name}
            email={user.email}
            role={user.role}
            branchName={user.branchName}
            firmName={user.firmName}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        </div>
        <main className="mx-auto w-full max-w-[1600px] px-3 pb-20 sm:px-5 sm:pb-6 lg:pb-6">
          <div key={pathname} className="route-enter">
            {children}
          </div>
        </main>
        <div className="no-print">
          <BottomNav permissions={user.permissions} onOpenSidebar={() => setSidebarOpen(true)} />
        </div>
      </div>
    </div>
  );
}
