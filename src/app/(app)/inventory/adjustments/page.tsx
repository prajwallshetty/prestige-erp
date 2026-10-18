import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { NewAdjustmentButton } from "./new-button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm, resolveBranchScope } from "@/lib/session";
import { formatDateTime } from "@/lib/dates";
import { ADJUSTMENT_TYPE_LABELS } from "@/lib/workflow";

export const metadata = { title: "Stock Adjustments — Technic Technologies" };

export default async function AdjustmentsPage() {
  const user = await requirePermissionInFirm("inventory.adjust");
  const scope = resolveBranchScope(user, null);

  const adjustments = await prisma.stockAdjustment.findMany({
    where: {
      firmId: user.activeFirmId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      product: { select: { name: true, sku: true } },
      branch: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });

  interface Row {
    id: string;
    number: string;
    product: string;
    branch: string;
    type: string;
    quantity: number;
    reason: string;
    by: string | null;
    date: Date;
  }
  const rows: Row[] = adjustments.map((adjustment) => ({
    id: adjustment.id,
    number: adjustment.adjustmentNumber,
    product: adjustment.product.name,
    branch: adjustment.branch.name,
    type: adjustment.type,
    quantity: adjustment.quantity,
    reason: adjustment.reason,
    by: adjustment.createdBy?.name ?? null,
    date: adjustment.createdAt,
  }));

  const columns: Column<Row>[] = [
    { key: "number", header: "Adjustment #", cell: (row) => <span className="font-medium">{row.number}</span> },
    { key: "product", header: "Product", cell: (row) => <span className="line-clamp-1">{row.product}</span> },
    { key: "branch", header: "Branch", hideOnMobile: true, cell: (row) => row.branch },
    {
      key: "type",
      header: "Type",
      hideOnMobile: true,
      cell: (row) => <Badge tone="outline">{ADJUSTMENT_TYPE_LABELS[row.type] ?? row.type}</Badge>,
    },
    {
      key: "qty",
      header: "Qty",
      headerClassName: "text-right",
      className: "text-right numeric font-medium",
      cell: (row) => (
        <span className={row.quantity >= 0 ? "text-success" : "text-destructive"}>
          {row.quantity > 0 ? "+" : ""}{row.quantity}
        </span>
      ),
    },
    { key: "reason", header: "Reason", hideOnMobile: true, cell: (row) => <span className="line-clamp-1 text-muted-foreground">{row.reason}</span> },
    { key: "date", header: "When", cell: (row) => <span className="numeric text-xs">{formatDateTime(row.date)}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Adjustments"
        description="Increase, decrease, damage, loss and correction — every change writes a stock transaction"
        actions={<NewAdjustmentButton />}
      />
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No adjustments recorded" />}
        renderMobileCard={(row) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.number}</span>
              <span className={`numeric font-semibold ${row.quantity >= 0 ? "text-success" : "text-destructive"}`}>
                {row.quantity > 0 ? "+" : ""}{row.quantity}
              </span>
            </div>
            <p className="line-clamp-1 text-sm text-muted-foreground">{row.product} · {ADJUSTMENT_TYPE_LABELS[row.type] ?? row.type}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(row.date)}</p>
          </div>
        )}
      />
    </div>
  );
}
