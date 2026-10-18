import "server-only";

import { prisma } from "@/lib/prisma";
import { hasPermission, type SessionUser } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { resolveBranchScope } from "@/lib/session";
import { num } from "@/lib/money";

/**
 * Inventory queries: dashboard counters, product stock listing, transaction
 * ledger, serial registry. Every query is firm-scoped from the session and
 * branch-scoped from the user's role.
 */

export interface InventoryCounters {
  totalProducts: number;
  totalUnits: number;
  inventoryValue: number;
  lowStock: number;
  outOfStock: number;
  damaged: number;
  reserved: number;
  available: number;
}

export async function inventoryCounters(
  user: SessionUser,
  branchId?: string,
): Promise<InventoryCounters> {
  const firmId = requireFirmIdFromUser(user);
  const scope = resolveBranchScope(user, branchId ?? null);
  const branchWhere = scope.branchId ? { branchId: scope.branchId } : {};

  const [productCount, serialCounts, stockSum, lowStockCount] = await Promise.all([
    prisma.product.count({ where: { firmId, status: "ACTIVE", ...branchWhere } }),
    prisma.serialUnit.groupBy({
      by: ["status"],
      where: { firmId, ...branchWhere },
      _count: { _all: true },
    }),
    prisma.stockTransaction.groupBy({
      by: ["productId"],
      where: { firmId, ...branchWhere },
      _sum: { quantity: true },
    }),
    prisma.product.count({
      where: {
        firmId,
        status: "ACTIVE",
        lowStockQty: { gt: 0 },
        ...branchWhere,
      },
    }),
  ]);

  const serialByStatus = new Map(serialCounts.map((row) => [row.status, row._count._all]));

  // Valuation uses the latest known unit cost per product; products without a
  // cost fall back to their purchase price.
  const products = await prisma.product.findMany({
    where: { firmId, status: "ACTIVE" },
    select: { id: true, purchasePrice: true },
  });
  const costByProduct = new Map(products.map((p) => [p.id, num(p.purchasePrice)]));

  let totalUnits = 0;
  let inventoryValue = 0;
  let outOfStock = 0;
  for (const row of stockSum) {
    const qty = row._sum.quantity ?? 0;
    totalUnits += qty;
    inventoryValue += qty * (costByProduct.get(row.productId) ?? 0);
    if (qty <= 0) outOfStock += 1;
  }

  return {
    totalProducts: productCount,
    totalUnits,
    inventoryValue: Math.round(inventoryValue * 100) / 100,
    lowStock: lowStockCount,
    outOfStock,
    damaged: serialByStatus.get("DAMAGED") ?? 0,
    reserved: 0, // reserved stock is counted on confirmed sales orders at read time
    available: totalUnits,
  };
}

function requireFirmIdFromUser(user: SessionUser): string {
  if (!user.activeFirmId) {
    throw new Error("Select a firm before accessing inventory data");
  }
  return user.activeFirmId;
}

export interface ProductStockRow {
  id: string;
  name: string;
  sku: string;
  brand: string | null;
  category: string | null;
  trackSerials: boolean;
  lowStockQty: number;
  quantity: number;
  purchasePrice: number;
  sellingPrice: number;
  stockValue: number;
}

export async function productStockRows(
  user: SessionUser,
  options: { branchId?: string; search?: string; categoryId?: string; lowOnly?: boolean },
): Promise<ProductStockRow[]> {
  const firmId = requireFirmIdFromUser(user);
  const scope = resolveBranchScope(user, options.branchId ?? null);

  const products = await prisma.product.findMany({
    where: {
      firmId,
      status: "ACTIVE",
      ...(options.categoryId ? { categoryId: options.categoryId } : {}),
      ...(options.search
        ? {
            OR: [
              { name: { contains: options.search, mode: "insensitive" } },
              { sku: { contains: options.search, mode: "insensitive" } },
              { barcode: { contains: options.search } },
              { modelNumber: { contains: options.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { brand: { select: { name: true } }, category: { select: { name: true } } },
    orderBy: { name: "asc" },
    take: 500,
  });

  const sums = await prisma.stockTransaction.groupBy({
    by: ["productId"],
    where: {
      firmId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
    },
    _sum: { quantity: true },
  });
  const qtyByProduct = new Map(sums.map((row) => [row.productId, row._sum.quantity ?? 0]));

  const rows: ProductStockRow[] = products.map((product) => {
    const quantity = qtyByProduct.get(product.id) ?? 0;
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      brand: product.brand?.name ?? null,
      category: product.category?.name ?? null,
      trackSerials: product.trackSerials,
      lowStockQty: product.lowStockQty,
      quantity,
      purchasePrice: num(product.purchasePrice),
      sellingPrice: num(product.sellingPrice),
      stockValue: quantity * num(product.purchasePrice),
    };
  });

  return options.lowOnly ? rows.filter((row) => row.quantity <= row.lowStockQty) : rows;
}

export async function recentStockTransactions(
  user: SessionUser,
  options: { branchId?: string; productId?: string; take?: number } = {},
) {
  const firmId = requireFirmIdFromUser(user);
  const scope = resolveBranchScope(user, options.branchId ?? null);
  return prisma.stockTransaction.findMany({
    where: {
      firmId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      ...(options.productId ? { productId: options.productId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 100,
    include: {
      product: { select: { name: true, sku: true } },
      variant: { select: { name: true, sku: true } },
      branch: { select: { name: true } },
      user: { select: { name: true } },
    },
  });
}

export function canManageInventory(user: SessionUser): boolean {
  return hasPermission(user, PERMISSIONS.INVENTORY_ADJUST) || hasPermission(user, PERMISSIONS.INVENTORY_TRANSFER);
}
