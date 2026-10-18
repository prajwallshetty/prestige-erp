import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { TransferWorkflowButton } from "./workflow-button";
import { NewTransferButton } from "./new-button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import { formatDateTime } from "@/lib/dates";
import { STOCK_TRANSFER_STATUS_LABELS } from "@/lib/workflow";

export const metadata = { title: "Stock Transfers — Technic Technologies" };

export default async function TransfersPage() {
  const user = await requirePermissionInFirm("inventory.transfer");

  const transfers = await prisma.stockTransfer.findMany({
    where: { firmId: user.activeFirmId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      fromBranch: { select: { name: true } },
      toBranch: { select: { name: true } },
      lines: { select: { quantity: true } },
    },
  });

  interface Row {
    id: string;
    number: string;
    from: string;
    to: string;
    units: number;
    status: string;
    date: Date;
  }
  const rows: Row[] = transfers.map((transfer) => ({
    id: transfer.id,
    number: transfer.transferNumber,
    from: transfer.fromBranch.name,
    to: transfer.toBranch.name,
    units: transfer.lines.reduce((sum, line) => sum + line.quantity, 0),
    status: transfer.status,
    date: transfer.createdAt,
  }));

  const columns: Column<Row>[] = [
    { key: "number", header: "Transfer #", cell: (row) => <span className="font-medium">{row.number}</span> },
    { key: "route", header: "Route", cell: (row) => <span className="text-sm">{row.from} → {row.to}</span> },
    { key: "units", header: "Units", headerClassName: "text-right", className: "text-right numeric", hideOnMobile: true, cell: (row) => row.units },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} label={STOCK_TRANSFER_STATUS_LABELS[row.status] ?? row.status} dot /> },
    { key: "date", header: "Created", hideOnMobile: true, cell: (row) => <span className="numeric text-xs">{formatDateTime(row.date)}</span> },
    {
      key: "actions",
      header: "",
      headerClassName: "text-right",
      cell: (row) => <TransferWorkflowButton transferId={row.id} status={row.status} />,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Transfers"
        description="Draft → Requested → Approved → In transit → Received — stock moves only through the workflow"
        actions={<NewTransferButton />}
      />
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No transfers yet" description="Create a transfer to move stock between branches." />}
        renderMobileCard={(row) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.number}</span>
              <StatusBadge status={row.status} label={STOCK_TRANSFER_STATUS_LABELS[row.status] ?? row.status} />
            </div>
            <p className="text-sm text-muted-foreground">{row.from} → {row.to} · {row.units} unit(s)</p>
            <TransferWorkflowButton transferId={row.id} status={row.status} />
          </div>
        )}
      />
    </div>
  );
}
