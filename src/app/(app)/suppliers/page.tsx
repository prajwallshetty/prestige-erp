import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { AddSupplierButton } from "./add-button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import { formatCurrency } from "@/lib/money";

export const metadata = { title: "Suppliers — Technic Technologies" };

export default async function SuppliersPage() {
  const user = await requirePermissionInFirm("suppliers.view");

  const suppliers = await prisma.supplier.findMany({
    where: { firmId: user.activeFirmId },
    orderBy: { name: "asc" },
    take: 200,
  });

  interface Row {
    id: string;
    code: string;
    name: string;
    phone: string | null;
    gstin: string | null;
    state: string | null;
    outstanding: number;
    totalPurchased: number;
  }
  const rows: Row[] = suppliers.map((supplier) => ({
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    phone: supplier.phone,
    gstin: supplier.gstin,
    state: supplier.state,
    outstanding: Number(supplier.outstandingAmount),
    totalPurchased: Number(supplier.totalPurchased),
  }));

  const columns: Column<Row>[] = [
    { key: "name", header: "Supplier", cell: (row) => (
      <Link href={`/ledgers/supplier?party=${row.id}`} className="font-medium hover:text-primary hover:underline" title="Open supplier ledger">{row.name}<span className="ml-2 text-xs font-normal text-muted-foreground">{row.code}</span></Link>
    ) },
    { key: "phone", header: "Phone", hideOnMobile: true, cell: (row) => <span className="numeric">{row.phone || "—"}</span> },
    { key: "gstin", header: "GSTIN", hideOnMobile: true, cell: (row) => <span className="font-mono text-xs">{row.gstin || "—"}</span> },
    { key: "state", header: "State", hideOnMobile: true, cell: (row) => row.state ?? "—" },
    { key: "purchased", header: "Purchased", headerClassName: "text-right", className: "text-right numeric", hideOnMobile: true, cell: (row) => formatCurrency(row.totalPurchased) },
    {
      key: "outstanding",
      header: "Payable",
      headerClassName: "text-right",
      className: "text-right numeric font-medium",
      cell: (row) => (
        <Badge tone={row.outstanding > 0 ? "warning" : "neutral"}>{formatCurrency(row.outstanding)}</Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Suppliers"
        description={`${rows.length} suppliers`}
        actions={user.permissions.includes("suppliers.manage") ? <AddSupplierButton /> : null}
      />
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
            <p className="numeric text-sm text-muted-foreground">{row.phone ?? "—"} · {row.code}</p>
          </div>
        )}
      />
    </div>
  );
}
