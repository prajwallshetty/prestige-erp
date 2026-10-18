import { NextResponse } from "next/server";

import { getCurrentUser, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { errorStatus } from "@/lib/action-result";

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

    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    const products = await prisma.product.findMany({
      where: {
        firmId: user.activeFirmId,
        status: "ACTIVE",
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { subName: { contains: query, mode: "insensitive" } },
                { sku: { contains: query, mode: "insensitive" } },
                { barcode: query },
              ],
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
      },
      orderBy: { name: "asc" },
      take: 100,
    });

    return NextResponse.json({
      products: products.map((product) => ({
        ...product,
        purchasePrice: Number(product.purchasePrice),
        sellingPrice: Number(product.sellingPrice),
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: errorStatus(error) });
  }
}
