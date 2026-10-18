import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { listAuditLogs } from "@/lib/services/audit-log";
import { requirePermissionInFirm, resolveBranchScope } from "@/lib/session";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Audit Logs — Technic Technologies" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermissionInFirm("audit.view");
  const params = await searchParams;
  const scope = resolveBranchScope(user, null);

  const rows = await listAuditLogs({
    firmId: user.activeFirmId,
    branchId: scope.branchId,
    search: params.q,
    action: params.action && params.action !== "all" ? params.action : undefined,
  });

  const columns: Column<(typeof rows)[number]>[] = [
    { key: "time", header: "When", cell: (row) => <span className="numeric text-xs">{formatDateTime(row.createdAt)}</span> },
    {
      key: "user",
      header: "User",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.userName}</p>
          <p className="text-xs text-muted-foreground">{row.userRole}</p>
        </div>
      ),
    },
    { key: "action", header: "Action", hideOnMobile: true, cell: (row) => <Badge tone="outline">{row.action.replaceAll("_", " ").toLowerCase()}</Badge> },
    { key: "summary", header: "Summary", cell: (row) => <span className="line-clamp-2 text-sm">{row.summary ?? "—"}</span> },
    { key: "ip", header: "IP", hideOnMobile: true, cell: (row) => <span className="font-mono text-xs">{row.ipAddress ?? "—"}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Audit Logs" description="Every privileged action, who did it and when — redacted of secrets" />

      <FilterBar
        searchPlaceholder="Search user, entity, summary…"
        filters={[
          {
            name: "action",
            label: "Action",
            options: [
              { value: "LOGIN", label: "Login" },
              { value: "INVOICE_CREATED", label: "Invoice created" },
              { value: "INVOICE_CANCELLED", label: "Invoice cancelled" },
              { value: "PAYMENT_CREATED", label: "Payment recorded" },
              { value: "STOCK_ADJUSTED", label: "Stock adjusted" },
              { value: "ACCESS_CODE_USED", label: "Access code used" },
              { value: "ACCESS_CODE_FAILED", label: "Access code failed" },
              { value: "USER_UPDATED", label: "User updated" },
            ],
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No audit entries found" />}
        renderMobileCard={(row) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{row.userName}</span>
              <Badge tone="outline">{row.action.replaceAll("_", " ").toLowerCase()}</Badge>
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">{row.summary ?? row.entity}</p>
            <p className="numeric text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</p>
          </div>
        )}
      />
    </div>
  );
}
