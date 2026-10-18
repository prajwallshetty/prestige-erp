"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Menu, Package, Receipt, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PermissionCode } from "@/lib/rbac";

interface BottomNavProps {
  onOpenSidebar: () => void;
  permissions: PermissionCode[];
}

/** The user needs at least one of the listed permissions to see the link. */
const ITEMS: { href: string; label: string; icon: typeof LayoutDashboard; permissions: PermissionCode[] }[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, permissions: ["dashboard.view"] },
  { href: "/pos", label: "Sell", icon: MonitorSmartphone, permissions: ["sales.create", "invoice.create"] },
  { href: "/products", label: "Stock", icon: Package, permissions: ["products.view"] },
  { href: "/invoices", label: "Invoices", icon: Receipt, permissions: ["invoice.view"] },
];

export function BottomNav({ onOpenSidebar, permissions }: BottomNavProps) {
  const pathname = usePathname();
  const visible = ITEMS.filter((item) => item.permissions.some((code) => permissions.includes(code)));

  const isNavActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const linkClass = (href: string) =>
    cn(
      "flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium transition-colors",
      isNavActive(href) ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-border bg-card/95 px-1 backdrop-blur lg:hidden safe-area-pb shadow-[0_-4px_16px_-8px_rgb(18_53_36_/_0.18)]"
      aria-label="Mobile navigation"
    >
      {visible.map((item) => (
        <Link key={item.href} href={item.href} className={linkClass(item.href)}>
          <item.icon className="size-5" />
          <span className="mt-0.5 truncate">{item.label}</span>
        </Link>
      ))}

      <button
        type="button"
        onClick={onOpenSidebar}
        className="flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Open full menu"
      >
        <Menu className="size-5" />
        <span className="mt-0.5 truncate">More</span>
      </button>
    </nav>
  );
}
