import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { Pagination } from "@/components/shared/pagination";
import { Badge } from "@/components/ui/badge";
import { AddCustomerButton } from "./add-button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { CUSTOMER_TYPE_LABELS } from "@/lib/workflow";
import { parsePageParam } from "@/lib/utils";

export const metadata = { title: "Customers — Technic Technologies" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermissionInFirm("customers.view");
  const params = await searchParams;
  const page = parsePageParam(params.page);
  const pageSize = 25;

  const where = {
    firmId: user.activeFirmId,
    ...(params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: "insensitive" as const } },
            { phone: { contains: params.q } },
            { code: { contains: params.q, mode: "insensitive" as const } },
            { gstin: { contains: params.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { branch: { select: { name: true } } },
    }),
  ]);

  interface Row {
    id: string;
    code: string;
    name: string;
    phone: string;
    type: string;
    gstin: string | null;
    outstanding: number;
    totalBilled: number;
  }
  const rows: Row[] = customers.map((customer) => ({
    id: customer.id,
    code: customer.code,
    name: customer.name,
    phone: customer.phone,
    type: customer.type,
    gstin: customer.gstin,
    outstanding: Number(customer.outstandingAmount),
    totalBilled: Number(customer.totalBilled),
  }));

  const columns: Column<Row>[] = [
    { key: "name", header: "Customer", cell: (row) => (
      <span className="font-medium">{row.name}<span className="ml-2 text-xs font-normal text-muted-foreground">{row.code}</span></span>
    ) },
    { key: "phone", header: "Phone", hideOnMobile: true, cell: (row) => <span className="numeric">{row.phone}</span> },
    { key: "type", header: "Type", hideOnMobile: true, cell: (row) => <Badge tone="outline">{CUSTOMER_TYPE_LABELS[row.type] ?? row.type}</Badge> },
    { key: "gstin", header: "GSTIN", hideOnMobile: true, cell: (row) => <span className="font-mono text-xs">{row.gstin || "—"}</span> },
    { key: "billed", header: "Billed", headerClassName: "text-right", className: "text-right numeric", hideOnMobile: true, cell: (row) => formatCurrency(row.totalBilled) },
    {
      key: "outstanding",
      header: "Outstanding",
      headerClassName: "text-right",
      className: "text-right numeric font-medium",
      cell: (row) => (
        <span className={row.outstanding > 0 ? "text-warning" : "text-muted-foreground"}>
          {formatCurrency(row.outstanding)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description={`${total} customers`}
        actions={user.permissions.includes("customers.create") ? <AddCustomerButton /> : null}
      />

      <FilterBar searchPlaceholder="Name, phone, GSTIN…" />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        renderMobileCard={(row) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.name}</span>
              <span className="numeric font-semibold">{formatCurrency(row.outstanding)}</span>
            </div>
            <p className="numeric text-sm text-muted-foreground">{row.phone} · {row.code}</p>
          </div>
        )}
      />

      <Pagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
