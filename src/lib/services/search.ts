import "server-only";

import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/action-result";
import { num } from "@/lib/money";
import { getStockByBranch, getStockLevel } from "@/lib/services/inventory";
import { taxModeWhere } from "@/lib/session";

/**
 * Global search (topbar) and POS product lookup. Everything is firm-scoped;
 * product searches match name, SKU, barcode, model or serial number.
 */

export interface SearchHit {
  kind: "product" | "serial" | "customer" | "invoice" | "supplier" | "quotation";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export async function globalSearch(
  firmId: string,
  query: string,
  take = 8,
  taxModeFilter: Record<string, never> | Record<string, string> = {},
): Promise<SearchHit[]> {
  const cleaned = query.trim();
  if (cleaned.length < 2) return [];
  const contains = { contains: cleaned, mode: "insensitive" as const };

  const [products, customers, invoices, suppliers, quotations] = await Promise.all([
    prisma.product.findMany({
      where: {
        firmId,
        OR: [
          { name: contains },
          { subName: contains },
          { sku: contains },
          { barcode: cleaned },
          { modelNumber: contains },
          { brand: { name: contains } },
        ],
      },
      select: { id: true, name: true, subName: true, sku: true, sellingPrice: true },
      take,
    }),
    prisma.customer.findMany({
      where: {
        firmId,
        OR: [{ name: contains }, { phone: cleaned }, { code: contains }, { gstin: contains }],
      },
      select: { id: true, name: true, code: true, phone: true },
      take,
    }),
    prisma.invoice.findMany({
      where: { firmId, ...taxModeFilter, OR: [{ invoiceNumber: contains }, { billToName: contains }] },
      select: { id: true, invoiceNumber: true, billToName: true, totalAmount: true, status: true },
      take,
    }),
    prisma.supplier.findMany({
      where: { firmId, OR: [{ name: contains }, { phone: cleaned }, { code: contains }] },
      select: { id: true, name: true, code: true },
      take,
    }),
    prisma.quotation.findMany({
      where: { firmId, ...taxModeFilter, OR: [{ quotationNumber: contains }, { customer: { name: contains } }] },
      select: { id: true, quotationNumber: true, customerId: true, totalAmount: true },
      take,
    }),
  ]);

  // Serial-number search resolves to the product page.
  const serialUnits = await prisma.serialUnit.findMany({
    where: {
      firmId,
      OR: [{ serialNumber: cleaned }, { imei1: cleaned }, { imei2: cleaned }],
    },
    select: { id: true, serialNumber: true, productId: true, product: { select: { name: true } } },
    take,
  });

  const hits: SearchHit[] = [
    ...products.map((product) => ({
      kind: "product" as const,
      id: product.id,
      title: product.name,
      subtitle: `${product.subName ? `${product.subName} · ` : ""}SKU ${product.sku} · ₹${num(product.sellingPrice).toFixed(2)}`,
      href: `/products/${product.id}`,
    })),
    ...serialUnits.map((unit) => ({
      kind: "serial" as const,
      id: unit.id,
      title: unit.serialNumber,
      subtitle: unit.product.name,
      href: `/products/${unit.productId}`,
    })),
    ...customers.map((customer) => ({
      kind: "customer" as const,
      id: customer.id,
      title: customer.name,
      subtitle: `${customer.code} · ${customer.phone}`,
      href: `/customers/${customer.id}`,
    })),
    ...invoices.map((invoice) => ({
      kind: "invoice" as const,
      id: invoice.id,
      title: invoice.invoiceNumber,
      subtitle: `${invoice.billToName} · ₹${num(invoice.totalAmount).toFixed(2)}`,
      href: `/invoices/${invoice.id}`,
    })),
    ...suppliers.map((supplier) => ({
      kind: "supplier" as const,
      id: supplier.id,
      title: supplier.name,
      subtitle: `${supplier.code}`,
      href: `/suppliers/${supplier.id}`,
    })),
    ...quotations.map((quotation) => ({
      kind: "quotation" as const,
      id: quotation.id,
      title: quotation.quotationNumber,
      subtitle: `₹${num(quotation.totalAmount).toFixed(2)}`,
      href: `/quotations`,
    })),
  ];

  return hits;
}

/**
 * POS lookup: a barcode scan, SKU, serial or name fragment resolves to a
 * sellable product with its live stock for the POS branch.
 */
export async function posLookup(firmId: string, branchId: string, code: string) {
  const cleaned = code.trim();
  if (!cleaned) throw new NotFoundError("Scan or type a product code");

  // 1. Exact barcode / SKU / serial hit first.
  const serial = await prisma.serialUnit.findFirst({
    where: { firmId, OR: [{ serialNumber: cleaned }, { imei1: cleaned }, { imei2: cleaned }] },
    include: { product: { include: { variants: true, brand: true } } },
  });

  const product = serial
    ? serial.product
    : await prisma.product.findFirst({
        where: {
          firmId,
          status: "ACTIVE",
          OR: [{ barcode: cleaned }, { sku: cleaned }, { name: { contains: cleaned, mode: "insensitive" } }],
        },
        include: { variants: true, brand: true },
      });

  if (!product) throw new NotFoundError("No product matches that code");

  const stock = await getStockLevel(firmId, branchId, { productId: product.id });
  const byBranch = await getStockByBranch(firmId, { productId: product.id });

  return {
    product: {
      id: product.id,
      name: product.name,
      subName: product.subName,
      sku: product.sku,
      hsnCode: product.hsnCode,
      gstRate: num(product.gstRate),
      sellingPrice: num(product.sellingPrice),
      purchasePrice: num(product.purchasePrice),
      trackSerials: product.trackSerials,
      trackImei: product.trackImei,
      brand: product.brand?.name ?? null,
      variants: product.variants
        .filter((variant) => variant.isActive)
        .map((variant) => ({
          id: variant.id,
          name: variant.name,
          sku: variant.sku,
          sellingPrice: num(variant.sellingPrice),
        })),
    },
    matchedSerial: serial ? serial.serialNumber : null,
    stock,
    stockByBranch: [...byBranch.entries()].map(([bid, qty]) => ({ branchId: bid, quantity: qty })),
  };
}
