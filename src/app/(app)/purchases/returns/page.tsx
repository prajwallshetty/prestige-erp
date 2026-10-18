import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { NewPurchaseReturnButton } from "./new-button";

export const metadata = { title: "Purchase Returns — Technic Technologies" };

export default async function PurchaseReturnsPage() {
  const user = await requirePermissionInFirm("purchase.view");

  const returns = await prisma.purchaseReturn.findMany({
    where: { firmId: user.activeFirmId, ...taxModeWhere(user) },
    orderBy: { returnedAt: "desc" },
    take: 100,
    include: { supplier: { select: { name: true } } },
  });

  interface Row {
    id: string;
    number: string;
    supplier: string;
    reason: string;
    total: number;
    date: Date;
  }
  const rows: Row[] = returns.map((purchaseReturn) => ({
    id: purchaseReturn.id,
    number: purchaseReturn.returnNumber,
    supplier: purchaseReturn.supplier.name,
    reason: purchaseReturn.reason,
    total: Number(purchaseReturn.total),
    date: purchaseReturn.returnedAt,
  }));

  const columns: Column<Row>[] = [
    { key: "number", header: "Return #", cell: (row) => <Link href={`/purchases/returns/${row.id}`} className="font-medium hover:text-primary hover:underline">{row.number}</Link> },
    { key: "supplier", header: "Supplier", cell: (row) => row.supplier },
    { key: "reason", header: "Reason", hideOnMobile: true, cell: (row) => <span className="line-clamp-1 text-muted-foreground">{row.reason}</span> },
    { key: "date", header: "Date", hideOnMobile: true, cell: (row) => <span className="numeric">{formatDate(row.date)}</span> },
    { key: "total", header: "Amount", headerClassName: "text-right", className: "text-right numeric font-medium", cell: (row) => formatCurrency(row.total) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Returns"
        description="Goods sent back to suppliers — stock reduced, payable adjusted"
        actions={user.permissions.includes("purchase.create") ? <NewPurchaseReturnButton /> : null}
      />
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No purchase returns recorded" />}
        renderMobileCard={(row) => (
          <Link href={`/purchases/returns/${row.id}`} className="block space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.number}</span>
              <span className="numeric font-semibold">{formatCurrency(row.total)}</span>
            </div>
            <p className="text-sm text-muted-foreground">{row.supplier} · {formatDate(row.date)}</p>
          </Link>
        )}
      />
    </div>
  );
}
