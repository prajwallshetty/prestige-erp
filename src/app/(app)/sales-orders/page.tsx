import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { NewSalesOrderButton } from "./new-button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { SALES_ORDER_STATUS_LABELS } from "@/lib/workflow";

export const metadata = { title: "Sales Orders — Technic Technologies" };

export default async function SalesOrdersPage() {
  const user = await requirePermissionInFirm("sales.view");

  const orders = await prisma.salesOrder.findMany({
    where: { firmId: user.activeFirmId, ...taxModeWhere(user) },
    orderBy: { orderDate: "desc" },
    take: 100,
    include: {
      customer: { select: { name: true } },
      branch: { select: { name: true } },
    },
  });

  interface Row {
    id: string;
    number: string;
    customer: string;
    date: Date;
    total: number;
    status: string;
  }
  const rows: Row[] = orders.map((order) => ({
    id: order.id,
    number: order.orderNumber,
    customer: order.customer.name,
    date: order.orderDate,
    total: Number(order.totalAmount),
    status: order.status,
  }));

  const columns: Column<Row>[] = [
    { key: "number", header: "Order #", cell: (row) => <span className="font-medium">{row.number}</span> },
    { key: "customer", header: "Customer", cell: (row) => <span className="line-clamp-1">{row.customer}</span> },
    { key: "date", header: "Date", hideOnMobile: true, cell: (row) => <span className="numeric">{formatDate(row.date)}</span> },
    { key: "total", header: "Total", headerClassName: "text-right", className: "text-right numeric", cell: (row) => formatCurrency(row.total) },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} label={SALES_ORDER_STATUS_LABELS[row.status] ?? row.status} dot /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales Orders"
        description="Customer orders awaiting fulfilment — bill them from the POS or a quotation"
        actions={user.permissions.includes("sales.create") ? <NewSalesOrderButton /> : null}
      />
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No sales orders yet" description="Use “New sales order” to record a customer's confirmed order." />}
        renderMobileCard={(row) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.number}</span>
              <StatusBadge status={row.status} label={SALES_ORDER_STATUS_LABELS[row.status] ?? row.status} />
            </div>
            <p className="text-sm text-muted-foreground">{row.customer} · {formatDate(row.date)}</p>
            <p className="numeric text-sm font-semibold">{formatCurrency(row.total)}</p>
          </div>
        )}
      />
      <p className="text-xs text-muted-foreground">
        Orders become invoices via the <Link href="/pos" className="text-primary hover:underline">POS</Link> when the goods are handed over.
      </p>
    </div>
  );
}
