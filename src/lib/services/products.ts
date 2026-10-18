import "server-only";

import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";

/**
 * Product service. Electronics categories vary, so spec attributes live in
 * ProductAttribute rows — the schema never hardcodes capacity/RAM/voltage
 * columns.
 */

export interface ProductInput {
  firmId: string;
  name: string;
  /** Model / variant line shown under the name on documents. */
  subName?: string | null;
  sku: string;
  brandId?: string | null;
  categoryId?: string | null;
  subcategory?: string | null;
  barcode?: string | null;
  modelNumber?: string | null;
  partNumber?: string | null;
  hsnCode?: string | null;
  gstRate?: number;
  unit?: string;
  purchasePrice?: number;
  sellingPrice?: number;
  mrp?: number;
  minSellingPrice?: number;
  warrantyMonths?: number;
  warrantyType?: "STANDARD" | "EXTENDED" | "MANUFACTURER" | "SELLER";
  description?: string | null;
  imageUrl?: string | null;
  status?: "ACTIVE" | "INACTIVE";
  trackSerials?: boolean;
  trackImei?: boolean;
  lowStockQty?: number;
  branchId?: string | null;
  attributes?: { name: string; value: string }[];
  variants?: {
    name: string;
    sku: string;
    barcode?: string | null;
    purchasePrice?: number;
    sellingPrice?: number;
    mrp?: number;
    warrantyMonths?: number;
  }[];
  userId?: string | null;
}

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function validateGstin(gstin: string | null | undefined): boolean {
  if (!gstin) return true; // optional
  return GSTIN_REGEX.test(gstin.trim().toUpperCase());
}

export async function createProduct(input: ProductInput) {
  if (!input.name.trim()) throw new BusinessRuleError("Product name is required");
  if (!input.sku.trim()) throw new BusinessRuleError("SKU is required");
  if ((input.sellingPrice ?? 0) < 0 || (input.purchasePrice ?? 0) < 0) {
    throw new BusinessRuleError("Prices cannot be negative");
  }
  if (input.minSellingPrice && input.sellingPrice && input.minSellingPrice > input.sellingPrice) {
    throw new BusinessRuleError("Minimum selling price cannot exceed the selling price");
  }
  if (input.gstRate && (input.gstRate < 0 || input.gstRate > 28)) {
    throw new BusinessRuleError("GST rate must be between 0 and 28");
  }

  const duplicateSku = await prisma.product.findFirst({
    where: { firmId: input.firmId, sku: input.sku.trim() },
    select: { id: true },
  });
  if (duplicateSku) throw new BusinessRuleError(`SKU "${input.sku}" is already used in this firm`);

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        firmId: input.firmId,
        name: input.name.trim(),
        subName: input.subName?.trim() || null,
        sku: input.sku.trim().toUpperCase(),
        brandId: input.brandId ?? null,
        categoryId: input.categoryId ?? null,
        subcategory: input.subcategory ?? null,
        barcode: input.barcode?.trim() || null,
        modelNumber: input.modelNumber?.trim() || null,
        partNumber: input.partNumber?.trim() || null,
        hsnCode: input.hsnCode?.trim() || null,
        gstRate: input.gstRate ?? 18,
        unit: input.unit ?? "pcs",
        purchasePrice: input.purchasePrice ?? 0,
        sellingPrice: input.sellingPrice ?? 0,
        mrp: input.mrp ?? 0,
        minSellingPrice: input.minSellingPrice ?? 0,
        warrantyMonths: input.warrantyMonths ?? 0,
        warrantyType: input.warrantyType ?? "STANDARD",
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        status: input.status ?? "ACTIVE",
        trackSerials: input.trackSerials ?? false,
        trackImei: input.trackImei ?? false,
        lowStockQty: input.lowStockQty ?? 0,
        branchId: input.branchId ?? null,
        attributes: {
          create: (input.attributes ?? []).filter((a) => a.name.trim() && a.value.trim()),
        },
        variants: {
          create: (input.variants ?? []).map((variant) => ({
            name: variant.name,
            sku: variant.sku.trim().toUpperCase(),
            barcode: variant.barcode ?? null,
            purchasePrice: variant.purchasePrice ?? 0,
            sellingPrice: variant.sellingPrice ?? 0,
            mrp: variant.mrp ?? 0,
            warrantyMonths: variant.warrantyMonths ?? 0,
          })),
        },
      },
      include: { attributes: true, variants: true },
    });

    await recordAudit({
      action: "PRODUCT_CREATED",
      entity: "Product",
      entityId: product.id,
      summary: `${product.name} (${product.sku})`,
      firmId: input.firmId,
      userId: input.userId,
      after: { sku: product.sku, name: product.name },
    });

    return product;
  });
}

export async function updateProduct(firmId: string, productId: string, input: ProductInput) {
  const existing = await prisma.product.findFirst({ where: { id: productId, firmId } });
  if (!existing) throw new NotFoundError("Product not found");

  const duplicateSku = await prisma.product.findFirst({
    where: { firmId, sku: input.sku.trim(), id: { not: productId } },
    select: { id: true },
  });
  if (duplicateSku) throw new BusinessRuleError(`SKU "${input.sku}" is already used in this firm`);

  return prisma.$transaction(async (tx) => {
    // Replace the attribute set wholesale — the flexible-attribute contract.
    await tx.productAttribute.deleteMany({ where: { productId } });
    if (input.variants) {
      for (const variant of input.variants) {
        if (!variant.sku?.trim()) continue;
        await tx.productVariant.upsert({
          where: { productId_sku: { productId, sku: variant.sku.trim().toUpperCase() } },
          create: {
            productId,
            name: variant.name,
            sku: variant.sku.trim().toUpperCase(),
            barcode: variant.barcode ?? null,
            purchasePrice: variant.purchasePrice ?? 0,
            sellingPrice: variant.sellingPrice ?? 0,
            mrp: variant.mrp ?? 0,
            warrantyMonths: variant.warrantyMonths ?? 0,
          },
          update: {
            name: variant.name,
            barcode: variant.barcode ?? null,
            purchasePrice: variant.purchasePrice ?? 0,
            sellingPrice: variant.sellingPrice ?? 0,
            mrp: variant.mrp ?? 0,
            warrantyMonths: variant.warrantyMonths ?? 0,
          },
        });
      }
    }

    const product = await tx.product.update({
      where: { id: productId },
      data: {
        name: input.name.trim(),
        subName: input.subName?.trim() || null,
        sku: input.sku.trim().toUpperCase(),
        brandId: input.brandId ?? null,
        categoryId: input.categoryId ?? null,
        subcategory: input.subcategory ?? null,
        barcode: input.barcode?.trim() || null,
        modelNumber: input.modelNumber?.trim() || null,
        partNumber: input.partNumber?.trim() || null,
        hsnCode: input.hsnCode?.trim() || null,
        gstRate: input.gstRate ?? 18,
        unit: input.unit ?? "pcs",
        purchasePrice: input.purchasePrice ?? 0,
        sellingPrice: input.sellingPrice ?? 0,
        mrp: input.mrp ?? 0,
        minSellingPrice: input.minSellingPrice ?? 0,
        warrantyMonths: input.warrantyMonths ?? 0,
        warrantyType: input.warrantyType ?? "STANDARD",
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        status: input.status ?? "ACTIVE",
        trackSerials: input.trackSerials ?? false,
        trackImei: input.trackImei ?? false,
        lowStockQty: input.lowStockQty ?? 0,
        branchId: input.branchId ?? null,
        attributes: {
          create: (input.attributes ?? []).filter((a) => a.name.trim() && a.value.trim()),
        },
      },
      include: { attributes: true, variants: true },
    });

    await recordAudit({
      action: "PRODUCT_UPDATED",
      entity: "Product",
      entityId: product.id,
      summary: `${product.name} (${product.sku})`,
      firmId,
      userId: input.userId,
      before: { sku: existing.sku, name: existing.name, sellingPrice: Number(existing.sellingPrice) },
      after: { sku: product.sku, name: product.name, sellingPrice: Number(product.sellingPrice) },
    });

    return product;
  });
}

export async function deleteProduct(firmId: string, productId: string, userId?: string | null) {
  const product = await prisma.product.findFirst({
    where: { id: productId, firmId },
    include: { _count: { select: { invoiceLines: true, purchaseLines: true, serialUnits: true } } },
  });
  if (!product) throw new NotFoundError("Product not found");

  const hasHistory =
    product._count.invoiceLines > 0 || product._count.purchaseLines > 0 || product._count.serialUnits > 0;

  if (hasHistory) {
    // Never break document history — deactivate instead of deleting.
    await prisma.product.update({ where: { id: productId }, data: { status: "INACTIVE" } });
    await recordAudit({
      action: "PRODUCT_DELETED",
      entity: "Product",
      entityId: productId,
      summary: `${product.name} deactivated (has transaction history)`,
      firmId,
      userId,
    });
    return { deactivated: true };
  }

  await prisma.product.delete({ where: { id: productId } });
  await recordAudit({
    action: "PRODUCT_DELETED",
    entity: "Product",
    entityId: productId,
    summary: `${product.name} deleted`,
    firmId,
    userId,
  });
  return { deactivated: false };
}

// ---------------------------------------------------------------------------
// Serial / IMEI services
// ---------------------------------------------------------------------------

export async function lookupSerial(firmId: string, code: string) {
  const cleaned = code.trim();
  if (!cleaned) throw new NotFoundError("Enter a serial number, IMEI or invoice number");

  // Serial → IMEI → invoice number → customer phone, per the handover.
  const bySerial = await prisma.serialUnit.findFirst({
    where: { firmId, OR: [{ serialNumber: cleaned }, { imei1: cleaned }, { imei2: cleaned }] },
    include: {
      product: { select: { id: true, name: true, sku: true, brand: { select: { name: true } } } },
      variant: { select: { name: true } },
      branch: { select: { name: true } },
      soldInvoice: {
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          customer: { select: { id: true, name: true, phone: true } },
        },
      },
      warrantyRecords: true,
    },
  });
  if (bySerial) return { kind: "serial" as const, serialUnit: bySerial };

  const byInvoice = await prisma.invoice.findFirst({
    where: { firmId, invoiceNumber: cleaned },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      lines: { select: { id: true, description: true, serialNumbers: true, quantity: true } },
    },
  });
  if (byInvoice) return { kind: "invoice" as const, invoice: byInvoice };

  const byPhone = await prisma.customer.findFirst({
    where: { firmId, phone: { contains: cleaned } },
    select: { id: true, name: true, phone: true },
  });
  if (byPhone) return { kind: "customer" as const, customer: byPhone };

  throw new NotFoundError("No product, serial, invoice or customer matches that code");
}

export async function setSerialStatus(
  firmId: string,
  serialUnitId: string,
  status: "IN_STOCK" | "RETURNED" | "DAMAGED" | "WARRANTY",
  note: string | undefined,
  userId?: string | null,
) {
  const unit = await prisma.serialUnit.findFirst({ where: { id: serialUnitId, firmId } });
  if (!unit) throw new NotFoundError("Serial unit not found");
  if (unit.status === "SOLD") {
    throw new BusinessRuleError("A sold unit cannot be re-statused here — use a sales return");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.serialUnit.update({
      where: { id: serialUnitId },
      data: { status },
    });
    await tx.serialHistory.create({
      data: {
        serialUnitId,
        eventType:
          status === "DAMAGED" ? "DAMAGED" : status === "WARRANTY" ? "WARRANTY_CLAIMED" : "ADJUSTED",
        fromStatus: unit.status,
        toStatus: status,
        note: note ?? null,
        userId: userId ?? null,
      },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Warranty services
// ---------------------------------------------------------------------------

export async function lookupWarranty(
  firmId: string,
  code: string,
) {
  const cleaned = code.trim();
  const unit = await prisma.serialUnit.findFirst({
    where: { firmId, OR: [{ serialNumber: cleaned }, { imei1: cleaned }, { imei2: cleaned }] },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      soldInvoice: {
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          customer: { select: { id: true, name: true, phone: true } },
        },
      },
    },
  });

  let warranty = unit
    ? await prisma.warranty.findFirst({ where: { firmId, serialUnitId: unit.id } })
    : null;

  if (!warranty && unit?.soldInvoiceId) {
    warranty = await prisma.warranty.findFirst({
      where: { firmId, serialUnitId: unit.id },
    });
  }

  if (!unit && !warranty) {
    // Warranty lookup by invoice number.
    const invoice = await prisma.invoice.findFirst({
      where: { firmId, invoiceNumber: cleaned },
      include: { lines: { select: { id: true, description: true, serialNumbers: true } } },
    });
    if (invoice) {
      const warranties = await prisma.warranty.findMany({
        where: { firmId, invoiceId: invoice.id },
        include: {
          product: { select: { name: true, sku: true } },
          serialUnit: { select: { serialNumber: true, imei1: true, imei2: true } },
        },
      });
      return { kind: "invoice" as const, invoice, warranties };
    }
    throw new NotFoundError("No serial, IMEI or invoice matches that code");
  }

  // Keep expiry fresh at read time.
  if (warranty && warranty.status === "ACTIVE" && warranty.warrantyEnd.getTime() < Date.now()) {
    await prisma.warranty.update({ where: { id: warranty.id }, data: { status: "EXPIRED" } });
    warranty = { ...warranty, status: "EXPIRED" };
  }

  return { kind: "serial" as const, serialUnit: unit, warranty };
}

export async function claimWarranty(
  firmId: string,
  warrantyId: string,
  note: string | undefined,
  userId?: string | null,
) {
  const warranty = await prisma.warranty.findFirst({ where: { id: warrantyId, firmId } });
  if (!warranty) throw new NotFoundError("Warranty record not found");
  if (warranty.status === "EXPIRED") {
    throw new BusinessRuleError("This warranty has expired");
  }
  if (warranty.status !== "ACTIVE") {
    throw new BusinessRuleError(`This warranty is already ${warranty.status.toLowerCase()}`);
  }

  const [updated] = await prisma.$transaction([
    prisma.warranty.update({ where: { id: warrantyId }, data: { status: "CLAIMED" } }),
    prisma.serialUnit.updateMany({
      where: { id: warranty.serialUnitId ?? "__none__" },
      data: { status: "WARRANTY" },
    }),
  ]);

  if (warranty.serialUnitId) {
    await prisma.serialHistory.create({
      data: {
        serialUnitId: warranty.serialUnitId,
        eventType: "WARRANTY_CLAIMED",
        fromStatus: "SOLD",
        toStatus: "WARRANTY",
        note: note ?? "Warranty claimed",
        userId: userId ?? null,
      },
    });
  }

  await recordAudit({
    action: "WARRANTY_CLAIMED",
    entity: "Warranty",
    entityId: warrantyId,
    summary: note ?? "Warranty claimed",
    firmId,
    userId,
  });

  return updated;
}

export async function replaceWarrantyUnit(
  firmId: string,
  warrantyId: string,
  newSerialUnitId: string,
  userId?: string | null,
) {
  const warranty = await prisma.warranty.findFirst({
    where: { id: warrantyId, firmId },
    include: { serialUnit: true },
  });
  if (!warranty) throw new NotFoundError("Warranty record not found");
  if (warranty.status !== "CLAIMED") {
    throw new BusinessRuleError("Only a claimed warranty can be replaced");
  }
  const replacement = await prisma.serialUnit.findFirst({
    where: { id: newSerialUnitId, firmId, status: "IN_STOCK" },
  });
  if (!replacement) throw new NotFoundError("Replacement unit not found in stock");

  return prisma.$transaction(async (tx) => {
    await tx.warranty.update({
      where: { id: warrantyId },
      data: { status: "REPLACED" },
    });
    await tx.serialHistory.create({
      data: {
        serialUnitId: warranty.serialUnitId!,
        eventType: "WARRANTY_REPLACED",
        fromStatus: "WARRANTY",
        toStatus: "WARRANTY",
        note: `Replaced with ${replacement.serialNumber}`,
        userId: userId ?? null,
      },
    });
    // The replacement unit ships to the customer under the same warranty.
    await tx.serialUnit.update({
      where: { id: replacement.id },
      data: { status: "SOLD", soldInvoiceId: warranty.invoiceId },
    });
    await tx.serialHistory.create({
      data: {
        serialUnitId: replacement.id,
        eventType: "SOLD",
        fromStatus: "IN_STOCK",
        toStatus: "SOLD",
        note: `Warranty replacement for ${warranty.serialUnit?.serialNumber ?? "unit"}`,
        userId: userId ?? null,
      },
    });
    return { ok: true };
  });
}
