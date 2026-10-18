import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { RecordPaymentButton } from "./record-button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";
import { num } from "@/lib/money";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PAYMENT_DIRECTION_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/workflow";
import { Wallet } from "lucide-react";

export const metadata = { title: "Payments — Technic Technologies" };

export default async function PaymentsPage() {
  const user = await requirePermissionInFirm("payments.view");

  const [payments, receivables, refunds] = await Promise.all([
    prisma.payment.findMany({
      where: {
        firmId: user.activeFirmId,
        OR: [
          { invoice: taxModeWhere(user) },
          { purchaseInvoice: taxModeWhere(user) },
          { isAdvance: true },
          { salesReturn: { invoice: taxModeWhere(user) } },
        ],
      },
      orderBy: { paidAt: "desc" },
      take: 100,
      include: {
        customer: { select: { name: true } },
        invoice: { select: { invoiceNumber: true } },
        branch: { select: { name: true } },
      },
    }),
    prisma.customer.aggregate({
      where: { firmId: user.activeFirmId },
      _sum: { outstandingAmount: true },
    }),
    prisma.payment.aggregate({
      where: {
        firmId: user.activeFirmId,
        direction: "REFUND_OUT",
        OR: [
          { invoice: taxModeWhere(user) },
          { purchaseInvoice: taxModeWhere(user) },
          { isAdvance: true },
          { salesReturn: { invoice: taxModeWhere(user) } },
        ],
      },
      _sum: { amount: true },
    }),
  ]);

  interface Row {
    id: string;
    number: string;
    direction: string;
    customer: string | null;
    invoiceNumber: string | null;
    amount: number;
    method: string;
    date: Date;
  }
  const rows: Row[] = payments.map((payment) => ({
    id: payment.id,
    number: payment.paymentNumber,
    direction: payment.direction,
    customer: payment.customer?.name ?? null,
    invoiceNumber: payment.invoice?.invoiceNumber ?? null,
    amount: num(payment.amount),
    method: payment.method,
    date: payment.paidAt,
  }));

  const columns: Column<Row>[] = [
    { key: "number", header: "Receipt #", cell: (row) => <Link href={`/payments/${row.id}`} className="font-medium hover:text-primary hover:underline">{row.number}</Link> },
    {
      key: "direction",
      header: "Type",
      hideOnMobile: true,
      cell: (row) => (
        <Badge tone={row.direction === "CUSTOMER_IN" ? "success" : row.direction === "REFUND_OUT" ? "warning" : "neutral"}>
          {PAYMENT_DIRECTION_LABELS[row.direction] ?? row.direction}
        </Badge>
      ),
    },
    { key: "customer", header: "Customer", cell: (row) => row.customer ?? "—" },
    { key: "invoice", header: "Invoice", hideOnMobile: true, cell: (row) => row.invoiceNumber ?? "On account" },
    { key: "method", header: "Method", hideOnMobile: true, cell: (row) => PAYMENT_METHOD_LABELS[row.method] ?? row.method },
    { key: "date", header: "Date", hideOnMobile: true, cell: (row) => <span className="numeric">{formatDate(row.date)}</span> },
    {
      key: "amount",
      header: "Amount",
      headerClassName: "text-right",
      className: "text-right numeric font-medium",
      cell: (row) => formatCurrency(row.amount),
    },
    {
      key: "pdf",
      header: "",
      headerClassName: "text-right",
      cell: (row) =>
        row.direction === "CUSTOMER_IN" ? (
          <a href={`/api/documents/receipt/${row.id}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
            Receipt
          </a>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payments"
        description="Customer receipts, advances and refunds"
        actions={user.permissions.includes("payments.create") ? <RecordPaymentButton /> : null}
      />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total receivables" value={formatCurrency(num(receivables._sum.outstandingAmount))} icon={Wallet} tone="warning" />
        <StatCard label="Refunds issued" value={formatCurrency(num(refunds._sum.amount))} tone="danger" />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No payments recorded yet" />}
        renderMobileCard={(row) => (
          <Link href={`/payments/${row.id}`} className="block space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.number}</span>
              <span className="numeric font-semibold">{formatCurrency(row.amount)}</span>
            </div>
            <p className="text-sm text-muted-foreground">{row.customer ?? "On account"} · {PAYMENT_METHOD_LABELS[row.method] ?? row.method}</p>
            <p className="text-xs text-muted-foreground">{formatDate(row.date)}</p>
          </Link>
        )}
      />
    </div>
  );
}
