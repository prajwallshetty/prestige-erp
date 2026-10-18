import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ApproveReturnButton } from "./approve-button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { SALES_RETURN_STATUS_LABELS } from "@/lib/workflow";

export const metadata = { title: "Sales Returns — Technic Technologies" };

export default async function SalesReturnsPage() {
  const user = await requirePermissionInFirm("sales.view");

  const returns = await prisma.salesReturn.findMany({
    where: { firmId: user.activeFirmId, invoice: taxModeWhere(user) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      customer: { select: { name: true } },
      invoice: { select: { invoiceNumber: true } },
    },
  });

  interface Row {
    id: string;
    number: string;
    customer: string;
    invoiceNumber: string;
    reason: string;
    total: number;
    status: string;
    date: Date;
  }
  const rows: Row[] = returns.map((salesReturn) => ({
    id: salesReturn.id,
    number: salesReturn.returnNumber,
    customer: salesReturn.customer.name,
    invoiceNumber: salesReturn.invoice.invoiceNumber,
    reason: salesReturn.reason,
    total: Number(salesReturn.totalAmount),
    status: salesReturn.status,
    date: salesReturn.createdAt,
  }));

  const canApprove = user.permissions.includes("sales.cancel") || user.permissions.includes("invoice.cancel");

  const columns: Column<Row>[] = [
    { key: "number", header: "Return #", cell: (row) => <Link href={`/sales-returns/${row.id}`} className="font-medium hover:text-primary hover:underline">{row.number}</Link> },
    { key: "customer", header: "Customer", cell: (row) => <span className="line-clamp-1">{row.customer}</span> },
    { key: "invoice", header: "Against", hideOnMobile: true, cell: (row) => row.invoiceNumber },
    { key: "reason", header: "Reason", hideOnMobile: true, cell: (row) => <span className="line-clamp-1 text-muted-foreground">{row.reason}</span> },
    { key: "total", header: "Amount", headerClassName: "text-right", className: "text-right numeric", cell: (row) => formatCurrency(row.total) },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} label={SALES_RETURN_STATUS_LABELS[row.status] ?? row.status} dot /> },
    {
      key: "actions",
      header: "",
      headerClassName: "text-right",
      cell: (row) =>
        row.status === "PENDING" && canApprove ? <ApproveReturnButton returnId={row.id} /> : null,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Sales Returns" description="Approved returns restore stock and refund the customer" />
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No returns recorded" description="Returns are raised against an invoice." />}
        renderMobileCard={(row) => (
          <Link href={`/sales-returns/${row.id}`} className="block space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.number}</span>
              <StatusBadge status={row.status} label={SALES_RETURN_STATUS_LABELS[row.status] ?? row.status} />
            </div>
            <p className="text-sm text-muted-foreground">{row.customer} · {row.invoiceNumber}</p>
            <div className="flex items-center justify-between text-sm">
              <span>{formatDate(row.date)}</span>
              <span className="numeric font-semibold">{formatCurrency(row.total)}</span>
            </div>
            {row.status === "PENDING" && canApprove ? <ApproveReturnButton returnId={row.id} /> : null}
          </Link>
        )}
      />
    </div>
  );
}
