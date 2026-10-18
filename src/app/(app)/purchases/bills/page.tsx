import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";
import { num } from "@/lib/money";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PURCHASE_INVOICE_STATUS_LABELS } from "@/lib/workflow";
import { PaySupplierButton } from "./pay-button";

export const metadata = { title: "Purchase Bills — Technic Technologies" };

export default async function PurchaseBillsPage() {
  const user = await requirePermissionInFirm("purchase.view");

  const bills = await prisma.purchaseInvoice.findMany({
    where: { firmId: user.activeFirmId, ...taxModeWhere(user) },
    orderBy: { invoiceDate: "desc" },
    take: 100,
    include: { supplier: { select: { name: true } } },
  });

  interface Row {
    id: string;
    number: string;
    supplier: string;
    supplierRef: string | null;
    date: Date;
    total: number;
    paid: number;
    status: string;
  }
  const rows: Row[] = bills.map((bill) => ({
    id: bill.id,
    number: bill.invoiceNumber,
    supplier: bill.supplier.name,
    supplierRef: bill.supplierRef,
    date: bill.invoiceDate,
    total: num(bill.total),
    paid: num(bill.amountPaid),
    status: bill.status,
  }));

  const columns: Column<Row>[] = [
    { key: "number", header: "Bill #", cell: (row) => <Link href={`/purchases/bills/${row.id}`} className="font-medium hover:text-primary hover:underline">{row.number}</Link> },
    { key: "supplier", header: "Supplier", cell: (row) => <span className="line-clamp-1">{row.supplier}</span> },
    { key: "ref", header: "Supplier ref", hideOnMobile: true, cell: (row) => row.supplierRef ?? "—" },
    { key: "date", header: "Date", hideOnMobile: true, cell: (row) => <span className="numeric">{formatDate(row.date)}</span> },
    { key: "total", header: "Total", headerClassName: "text-right", className: "text-right numeric", cell: (row) => formatCurrency(row.total) },
    {
      key: "balance",
      header: "Balance",
      headerClassName: "text-right",
      className: "text-right numeric",
      cell: (row) => {
        const balance = row.total - row.paid;
        return balance > 0.001 ? (
          <span className="text-warning">{formatCurrency(balance)}</span>
        ) : (
          <span className="text-muted-foreground">Settled</span>
        );
      },
    },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} label={PURCHASE_INVOICE_STATUS_LABELS[row.status] ?? row.status} dot /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Bills"
        description="Supplier bills booked at goods receipt"
        actions={user.permissions.includes("payments.create") ? <PaySupplierButton /> : null}
      />
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No purchase bills yet" description="Bills are created when you receive goods." />}
        renderMobileCard={(row) => (
          <Link href={`/purchases/bills/${row.id}`} className="block space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.number}</span>
              <StatusBadge status={row.status} label={PURCHASE_INVOICE_STATUS_LABELS[row.status] ?? row.status} />
            </div>
            <p className="text-sm text-muted-foreground">{row.supplier} · {formatDate(row.date)}</p>
            <p className="numeric text-sm font-semibold">{formatCurrency(row.total)}</p>
          </Link>
        )}
      />
    </div>
  );
}
