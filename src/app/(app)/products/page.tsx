import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { Pagination } from "@/components/shared/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm, resolveBranchScope } from "@/lib/session";
import { getStockLevelsForProducts } from "@/lib/services/inventory";
import { formatCurrency, formatNumber } from "@/lib/money";
import { parsePageParam } from "@/lib/utils";

export const metadata = { title: "Products — Technic Technologies" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermissionInFirm("products.view");
  const params = await searchParams;
  const page = parsePageParam(params.page);
  const pageSize = 24;
  const firmId = user.activeFirmId;
  const scope = resolveBranchScope(user, params.branchId ?? null);

  const PRODUCT_STATUSES = ["ACTIVE", "INACTIVE"] as const;
  type ProductStatusValue = (typeof PRODUCT_STATUSES)[number];
  const status = PRODUCT_STATUSES.includes(params.status as ProductStatusValue)
    ? (params.status as ProductStatusValue)
    : "ACTIVE";

  const where = {
    firmId,
    // Active by default; the Status filter opts into deactivated items.
    status,
    ...(params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: "insensitive" as const } },
            { subName: { contains: params.q, mode: "insensitive" as const } },
            { sku: { contains: params.q, mode: "insensitive" as const } },
            { barcode: { contains: params.q } },
            { modelNumber: { contains: params.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(params.category && params.category !== "all" ? { categoryId: params.category } : {}),
  };

  const [total, products, categories] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        brand: { select: { name: true } },
        category: { select: { name: true } },
        _count: { select: { variants: true, serialUnits: true } },
      },
    }),
    prisma.category.findMany({
      where: { firmId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const stock = await getStockLevelsForProducts(
    firmId,
    scope.branchId ?? user.branchId ?? "",
    products.map((product) => product.id),
  );

  interface Row {
    id: string;
    name: string;
    subName: string | null;
    sku: string;
    brand: string | null;
    category: string | null;
    price: number;
    quantity: number;
    trackSerials: boolean;
  }
  const rows: Row[] = products.map((product) => ({
    id: product.id,
    name: product.name,
    subName: product.subName,
    sku: product.sku,
    brand: product.brand?.name ?? null,
    category: product.category?.name ?? null,
    price: Number(product.sellingPrice),
    quantity: stock.get(product.id) ?? 0,
    trackSerials: product.trackSerials,
  }));

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Product",
      cell: (row) => (
        <Link href={`/products/${row.id}`} className="font-medium hover:text-primary hover:underline">
          {row.name}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{row.sku}</span>
          {row.subName ? <span className="block text-xs font-normal text-muted-foreground">{row.subName}</span> : null}
        </Link>
      ),
    },
    { key: "brand", header: "Brand", hideOnMobile: true, cell: (row) => row.brand ?? "—" },
    { key: "category", header: "Category", hideOnMobile: true, cell: (row) => row.category ?? "—" },
    {
      key: "price",
      header: "Price",
      headerClassName: "text-right",
      className: "text-right numeric",
      cell: (row) => formatCurrency(row.price),
    },
    {
      key: "qty",
      header: "Stock",
      headerClassName: "text-right",
      className: "text-right numeric",
      cell: (row) => (
        <span className={row.quantity <= 0 ? "font-medium text-destructive" : ""}>
          {formatNumber(row.quantity)}
        </span>
      ),
    },
    {
      key: "flags",
      header: "",
      hideOnMobile: true,
      cell: (row) =>
        row.trackSerials ? <Badge tone="info">Serial tracked</Badge> : null,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        description={`${total} products in the catalogue`}
        actions={
          user.permissions.includes("products.create") ? (
            <Button asChild>
              <Link href="/products/new">Add product</Link>
            </Button>
          ) : null
        }
      />

      <FilterBar
        searchPlaceholder="Name, SKU, barcode…"
        filters={[
          {
            name: "category",
            label: "Category",
            options: categories.map((category) => ({ value: category.id, label: category.name })),
          },
          {
            name: "status",
            label: "Status",
            options: [
              { value: "ACTIVE", label: "Active" },
              { value: "INACTIVE", label: "Deactivated" },
            ],
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        renderMobileCard={(row) => (
          <Link href={`/products/${row.id}`} className="block space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.name}</span>
              <span className="numeric font-semibold">{formatCurrency(row.price)}</span>
            </div>
            {row.subName ? <p className="text-xs text-muted-foreground">{row.subName}</p> : null}
            <p className="text-xs text-muted-foreground">
              {row.sku} · {row.quantity} in stock{row.trackSerials ? " · serialized" : ""}
            </p>
          </Link>
        )}
      />

      <Pagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
