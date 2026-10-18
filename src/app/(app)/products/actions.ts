"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { createProduct, updateProduct, deleteProduct } from "@/lib/services/products";
import type { ProductInput } from "@/lib/services/products";

export async function createProductAction(
  input: Omit<import("@/lib/services/products").ProductInput, "firmId" | "userId">,
) {
  return runAction(async () => {
    const user = await authorize("products.create");
    const firmId = requireFirmId(user);

    const product = await createProduct({
      ...input,
      firmId,
      userId: user.id,
    });

    revalidatePath("/products");
    revalidatePath("/inventory");
    return {
      id: product.id,
      name: product.name,
      subName: product.subName,
      sku: product.sku,
      hsnCode: product.hsnCode,
      gstRate: Number(product.gstRate),
      purchasePrice: Number(product.purchasePrice),
      sellingPrice: Number(product.sellingPrice),
      trackSerials: product.trackSerials,
    };
  });
}

export async function updateProductAction(input: {
  id: string;
  name: string;
  subName?: string | null;
  sku: string;
  barcode?: string | null;
  hsnCode?: string | null;
  gstRate?: number;
  purchasePrice?: number;
  sellingPrice?: number;
  mrp?: number;
  warrantyMonths?: number;
  lowStockQty?: number;
  trackSerials?: boolean;
  trackImei?: boolean;
  description?: string | null;
}) {
  return runAction(async () => {
    const user = await authorize("products.edit");
    const firmId = requireFirmId(user);

    // updateProduct replaces attributes/variants wholesale, so re-apply the
    // existing rows instead of passing an empty replacement.
    const existing = await import("@/lib/prisma").then(({ prisma }) =>
      prisma.product.findFirst({
        where: { id: input.id, firmId },
        include: {
          attributes: { select: { name: true, value: true } },
          variants: true,
        },
      }),
    );
    if (!existing) throw new Error("Product not found");

    const patch: Partial<ProductInput> = {
      name: input.name,
      subName: input.subName === undefined ? existing.subName : input.subName,
      sku: input.sku,
      barcode: input.barcode ?? null,
      hsnCode: input.hsnCode ?? null,
      gstRate: input.gstRate,
      purchasePrice: input.purchasePrice,
      sellingPrice: input.sellingPrice,
      mrp: input.mrp,
      warrantyMonths: input.warrantyMonths,
      trackSerials: input.trackSerials,
      trackImei: input.trackImei,
      description: input.description ?? null,
    };
    // Only overwrite fields the edit form actually exposes.
    for (const key of Object.keys(patch) as (keyof ProductInput)[]) {
      if (patch[key] === undefined) delete patch[key];
    }

    const product = await updateProduct(firmId, input.id, {
      ...existing,
      firmId,
      name: patch.name ?? existing.name,
      sku: patch.sku ?? existing.sku,
      ...patch,
      brandId: existing.brandId,
      categoryId: existing.categoryId,
      subcategory: existing.subcategory,
      modelNumber: existing.modelNumber,
      partNumber: existing.partNumber,
      unit: existing.unit,
      minSellingPrice: Number(existing.minSellingPrice),
      warrantyType: existing.warrantyType,
      imageUrl: existing.imageUrl,
      status: existing.status,
      lowStockQty: patch.lowStockQty ?? existing.lowStockQty,
      branchId: existing.branchId,
      attributes: existing.attributes.map((a) => ({ name: a.name, value: a.value })),
      variants: existing.variants.map((v) => ({
        name: v.name,
        sku: v.sku,
        barcode: v.barcode,
        purchasePrice: Number(v.purchasePrice),
        sellingPrice: Number(v.sellingPrice),
        mrp: Number(v.mrp),
        warrantyMonths: v.warrantyMonths,
      })),
      userId: user.id,
    } as ProductInput);

    revalidatePath("/products");
    revalidatePath(`/products/${input.id}`);
    revalidatePath("/inventory");
    return { id: product.id, name: product.name };
  });
}

export async function toggleProductStatusAction(input: { id: string; active: boolean }) {
  return runAction(async () => {
    const user = await authorize("products.delete");
    const firmId = requireFirmId(user);

    if (input.active) {
      // Re-activation goes through the same edit path.
      const { prisma } = await import("@/lib/prisma");
      // Firm-scoped: never reactivate another firm's product.
      const { count } = await prisma.product.updateMany({
        where: { id: input.id, firmId },
        data: { status: "ACTIVE" },
      });
      if (count === 0) throw new Error("Product not found");
      revalidatePath("/products");
      revalidatePath(`/products/${input.id}`);
      return { id: input.id, active: true };
    }

    const result = await deleteProduct(firmId, input.id, user.id);
    revalidatePath("/products");
    revalidatePath(`/products/${input.id}`);
    revalidatePath("/inventory");
    return { id: input.id, deactivated: result.deactivated };
  });
}
