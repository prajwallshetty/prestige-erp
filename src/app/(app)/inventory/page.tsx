import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { AlertTriangle, Boxes, PackageX, Wallet } from "lucide-react";
import { inventoryCounters, productStockRows } from "@/lib/services/inventory-queries";
import { requirePermissionInFirm } from "@/lib/session";
import { formatCurrency, formatNumber } from "@/lib/money";

export const metadata = { title: "Stock — Technic Technologies" };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermissionInFirm("inventory.view");
  const params = await searchParams;

  const counters = await inventoryCounters(user, params.branchId);
  const rows = await productStockRows(user, {
    branchId: params.branchId,
    search: params.q,
    categoryId: params.category !== "all" ? params.category : undefined,
    lowOnly: params.low === "1",
  });

  interface Row {
    id: string;
    name: string;
    sku: string;
    category: string | null;
    quantity: number;
    lowStockQty: number;
    stockValue: number;
    trackSerials: boolean;
  }

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Product",
      cell: (row) => (
        <Link href={`/products/${row.id}`} className="font-medium hover:text-primary hover:underline">
          {row.name}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{row.sku}</span>
        </Link>
      ),
    },
    { key: "category", header: "Category", hideOnMobile: true, cell: (row) => row.category ?? "—" },
    {
      key: "qty",
      header: "On hand",
      headerClassName: "text-right",
      className: "text-right numeric font-medium",
      cell: (row) => (
        <span className={row.quantity <= 0 ? "text-destructive" : row.lowStockQty > 0 && row.quantity <= row.lowStockQty ? "text-warning" : ""}>
          {formatNumber(row.quantity)}
        </span>
      ),
    },
    {
      key: "value",
      header: "Stock value",
      headerClassName: "text-right",
      className: "text-right numeric",
      hideOnMobile: true,
      cell: (row) => formatCurrency(row.stockValue),
    },
    {
      key: "flags",
      header: "",
      hideOnMobile: true,
      cell: (row) => (row.trackSerials ? <span className="text-xs text-muted-foreground">serialized</span> : null),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Stock" description="Transaction-driven stock levels across your branches" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Products" value={counters.totalProducts} icon={Boxes} />
        <StatCard label="Units on hand" value={formatNumber(counters.totalUnits)} />
        <StatCard label="Inventory value" value={formatCurrency(counters.inventoryValue)} icon={Wallet} />
        <StatCard label="Low / out of stock" value={`${counters.lowStock} / ${counters.outOfStock}`} icon={AlertTriangle} tone="warning" />
      </div>

      <FilterBar
        searchPlaceholder="Product, SKU, barcode…"
        filters={[
          { name: "low", label: "Low stock", options: [{ value: "1", label: "Low stock only" }] },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        renderMobileCard={(row) => (
          <Link href={`/products/${row.id}`} className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate font-medium">{row.name}</p>
              <p className="text-xs text-muted-foreground">{row.sku}</p>
            </div>
            <span className="numeric font-semibold">{formatNumber(row.quantity)}</span>
          </Link>
        )}
      />
    </div>
  );
}
