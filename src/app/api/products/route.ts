import { NextResponse } from "next/server";

import { getCurrentUser, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { errorStatus } from "@/lib/action-result";

/**
 * Product search used by the quotation, purchase and POS pickers.
 *
 * `q`   — matches name, sub-name, SKU, barcode, brand, category, attribute values
 *         (size / finish …) and variant name/SKU, so tile staff can type
 *         "kajaria 600x600 glossy".
 * `ids` — comma-separated product ids (to hydrate lines of an existing document).
 *
 * Stock is the transaction-ledger balance of the caller's branch and is only
 * returned to users who may view inventory.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (
      !user.activeFirmId ||
      !hasPermission(user, [PERMISSIONS.PRODUCT_VIEW, PERMISSIONS.PURCHASE_VIEW])
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = new URL(request.url).searchParams;
    const query = params.get("q")?.trim() ?? "";
    const ids = (params.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 100);

    const products = await prisma.product.findMany({
      where: {
        firmId: user.activeFirmId,
        ...(ids.length ? { id: { in: ids } } : { status: "ACTIVE" }),
        ...(query
          ? {
              AND: query.split(/\s+/).filter(Boolean).slice(0, 5).map((term) => ({
                OR: [
                  { name: { contains: term, mode: "insensitive" as const } },
                  { subName: { contains: term, mode: "insensitive" as const } },
                  { sku: { contains: term, mode: "insensitive" as const } },
                  { barcode: term },
                  { brand: { name: { contains: term, mode: "insensitive" as const } } },
                  { category: { name: { contains: term, mode: "insensitive" as const } } },
                  { subcategory: { contains: term, mode: "insensitive" as const } },
                  { attributes: { some: { value: { contains: term, mode: "insensitive" as const } } } },
                  {
                    variants: {
                      some: {
                        isActive: true,
                        OR: [
                          { name: { contains: term, mode: "insensitive" as const } },
                          { sku: { contains: term, mode: "insensitive" as const } },
                        ],
                      },
                    },
                  },
                ],
              })),
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        subName: true,
        sku: true,
        hsnCode: true,
        purchasePrice: true,
        sellingPrice: true,
        trackSerials: true,
        gstRate: true,
        unit: true,
        imageUrl: true,
        subcategory: true,
        brand: { select: { name: true } },
        category: { select: { name: true } },
        attributes: { select: { name: true, value: true }, take: 12 },
        variants: {
          where: { isActive: true },
          select: { id: true, name: true, sku: true, sellingPrice: true, mrp: true },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
      take: ids.length ? ids.length : query ? 40 : 100,
    });

    // Per-branch stock (products and variants) from the stock ledger.
    const stock = new Map<string, number>();
    const canSeeStock = hasPermission(user, PERMISSIONS.INVENTORY_VIEW) && Boolean(user.branchId);
    if (canSeeStock && products.length) {
      const rows = await prisma.stockTransaction.groupBy({
        by: ["productId", "variantId"],
        where: { firmId: user.activeFirmId, branchId: user.branchId!, productId: { in: products.map((p) => p.id) } },
        _sum: { quantity: true },
      });
      for (const row of rows) stock.set(`${row.productId}:${row.variantId ?? ""}`, row._sum.quantity ?? 0);
    }

    return NextResponse.json({
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        subName: product.subName,
        sku: product.sku,
        hsnCode: product.hsnCode,
        purchasePrice: Number(product.purchasePrice),
        sellingPrice: Number(product.sellingPrice),
        trackSerials: product.trackSerials,
        gstRate: Number(product.gstRate),
        unit: product.unit,
        imageUrl: product.imageUrl,
        brand: product.brand?.name ?? null,
        category: product.category?.name ?? null,
        subcategory: product.subcategory,
        attributes: product.attributes,
        stock: canSeeStock ? (stock.get(`${product.id}:`) ?? 0) : null,
        variants: product.variants.map((variant) => ({
          id: variant.id,
          name: variant.name,
          sku: variant.sku,
          sellingPrice: Number(variant.sellingPrice),
          mrp: Number(variant.mrp),
          stock: canSeeStock ? (stock.get(`${product.id}:${variant.id}`) ?? 0) : null,
        })),
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: errorStatus(error) });
  }
}
