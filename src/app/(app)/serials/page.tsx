import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm, resolveBranchScope } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { SERIAL_STATUS_LABELS } from "@/lib/workflow";
import { parsePageParam } from "@/lib/utils";

export const metadata = { title: "Serial Numbers — Technic Technologies" };

export default async function SerialsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermissionInFirm("serials.view");
  const params = await searchParams;
  const page = parsePageParam(params.page);
  const pageSize = 25;
  const scope = resolveBranchScope(user, params.branchId ?? null);

  const where = {
    firmId: user.activeFirmId,
    ...(scope.branchId ? { branchId: scope.branchId } : {}),
    ...(params.status && params.status !== "all" ? { status: params.status as never } : {}),
    ...(params.q
      ? {
          OR: [
            { serialNumber: { contains: params.q } },
            { imei1: { contains: params.q } },
            { imei2: { contains: params.q } },
          ],
        }
      : {}),
  };

  const [total, units] = await Promise.all([
    prisma.serialUnit.count({ where }),
    prisma.serialUnit.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        product: { select: { id: true, name: true, sku: true, trackImei: true } },
        branch: { select: { name: true } },
        soldInvoice: { select: { id: true, invoiceNumber: true } },
      },
    }),
  ]);

  interface Row {
    id: string;
    serial: string;
    imei: string | null;
    product: string;
    productId: string;
    branch: string;
    status: string;
    soldInvoiceNumber: string | null;
    soldInvoiceId: string | null;
    price: number;
    createdAt: Date;
    trackImei: boolean;
  }

  const rows: Row[] = units.map((unit) => ({
    id: unit.id,
    serial: unit.serialNumber,
    imei: unit.imei1,
    product: unit.product.name,
    productId: unit.product.id,
    branch: unit.branch.name,
    status: unit.status,
    soldInvoiceNumber: unit.soldInvoice?.invoiceNumber ?? null,
    soldInvoiceId: unit.soldInvoice?.id ?? null,
    price: Number(unit.sellingPrice),
    createdAt: unit.createdAt,
    trackImei: unit.product.trackImei,
  }));

  const columns: Column<Row>[] = [
    {
      key: "serial",
      header: "Serial",
      cell: (row) => <span className="font-mono text-xs font-medium">{row.serial}</span>,
    },
    {
      key: "imei",
      header: "IMEI",
      hideOnMobile: true,
      cell: (row) => <span className="font-mono text-xs">{row.imei || "—"}</span>,
    },
    {
      key: "product",
      header: "Product",
      cell: (row) => (
        <Link href={`/products/${row.productId}`} className="hover:text-primary hover:underline">
          {row.product}
        </Link>
      ),
    },
    { key: "branch", header: "Branch", hideOnMobile: true, cell: (row) => row.branch },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} label={SERIAL_STATUS_LABELS[row.status] ?? row.status} dot />,
    },
    {
      key: "sale",
      header: "Sold on",
      hideOnMobile: true,
      cell: (row) =>
        row.soldInvoiceId ? (
          <Link href={`/invoices/${row.soldInvoiceId}`} className="text-primary hover:underline">
            {row.soldInvoiceNumber}
          </Link>
        ) : (
          <span className="text-muted-foreground">{formatDate(row.createdAt)}</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Serial Numbers"
        description={`${total} tracked units — serials, IMEIs and their sale history`}
      />

      <FilterBar
        searchPlaceholder="Serial or IMEI…"
        filters={[
          {
            name: "status",
            label: "Status",
            options: [
              { value: "IN_STOCK", label: "In stock" },
              { value: "SOLD", label: "Sold" },
              { value: "RETURNED", label: "Returned" },
              { value: "DAMAGED", label: "Damaged" },
              { value: "WARRANTY", label: "Warranty" },
            ],
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No serial units found" description="Serials register automatically when you receive tracked products." />}
        renderMobileCard={(row) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-medium">{row.serial}</span>
              <StatusBadge status={row.status} label={SERIAL_STATUS_LABELS[row.status] ?? row.status} />
            </div>
            <p className="text-sm">{row.product}</p>
            {row.imei ? <p className="font-mono text-xs text-muted-foreground">IMEI {row.imei}</p> : null}
          </div>
        )}
      />

      <Pagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
