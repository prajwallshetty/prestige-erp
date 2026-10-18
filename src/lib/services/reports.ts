import "server-only";

import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { resolveBranchScope, requireFirmId, taxModeWhere } from "@/lib/session";
import { num } from "@/lib/money";
import { resolveDateRange, type DateRange } from "@/lib/dates";
import { financialYearFor } from "@/lib/sequence";

/**
 * Reports service. Every report is firm-scoped from the session, branch-scoped
 * from the user's role, and honours the report date presets including Indian
 * financial years (previous FY = the April–March year before the current one).
 */

export type ReportPreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "previous_month"
  | "this_fy"
  | "previous_fy"
  | "last7"
  | "last30"
  | "all";

function previousMonthRange(now: Date): DateRange {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  return { from: start, to: end };
}

function fyRange(fyString: string): DateRange {
  // fyString like "26-27" — April 1 of the start year to March 31 of the end.
  const startYear = 2000 + Number.parseInt(fyString.slice(0, 2), 10);
  return {
    from: new Date(startYear, 3, 1, 0, 0, 0, 0),
    to: new Date(startYear + 1, 2, 31, 23, 59, 59, 999),
  };
}

export function reportRange(preset: ReportPreset, fromParam?: string, toParam?: string): DateRange {
  const now = new Date();
  if (fromParam || toParam) {
    return {
      from: fromParam ? new Date(fromParam) : new Date(now.getFullYear(), now.getMonth(), 1),
      to: toParam ? new Date(`${toParam}T23:59:59.999Z`) : now,
    };
  }
  switch (preset) {
    case "today":
      return resolveDateRange("today")!;
    case "yesterday":
      return resolveDateRange("yesterday")!;
    case "this_week":
      return resolveDateRange("this_week")!;
    case "this_month":
      return resolveDateRange("this_month")!;
    case "previous_month":
      return previousMonthRange(now);
    case "this_fy":
      return fyRange(financialYearFor(now));
    case "previous_fy": {
      const current = financialYearFor(now);
      const prevStart = Number.parseInt(current.slice(0, 2), 10) - 1;
      return fyRange(`${String(prevStart).padStart(2, "0")}-${current.slice(3)}`);
    }
    case "last7":
      return resolveDateRange("last7")!;
    case "last30":
      return resolveDateRange("last30")!;
    default:
      return { from: new Date(2000, 0, 1), to: now };
  }
}

export interface SalesReportRow {
  invoiceNumber: string;
  invoiceDate: Date;
  kind: string;
  customerName: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  paid: number;
  due: number;
  staffName: string | null;
}

export async function salesReport(
  user: SessionUser,
  options: { preset?: ReportPreset; from?: string; to?: string; branchId?: string },
): Promise<{ range: DateRange; rows: SalesReportRow[]; totals: { subtotal: number; tax: number; total: number; paid: number; due: number } }> {
  const firmId = requireFirmId(user);
  const scope = resolveBranchScope(user, options.branchId ?? null);
  const range = reportRange(options.preset ?? "this_month", options.from, options.to);
  const tm = taxModeWhere(user);

  const invoices = await prisma.invoice.findMany({
    where: {
      firmId,
      status: { not: "CANCELLED" },
      invoiceDate: { gte: range.from, lte: range.to },
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      ...tm,
    },
    include: { createdBy: { select: { name: true } } },
    orderBy: { invoiceDate: "desc" },
  });

  const rows: SalesReportRow[] = invoices.map((invoice) => ({
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    kind: invoice.kind,
    customerName: invoice.billToName,
    subtotal: num(invoice.subtotal),
    taxAmount: num(invoice.cgstAmount) + num(invoice.sgstAmount) + num(invoice.igstAmount),
    total: num(invoice.totalAmount),
    paid: num(invoice.amountPaid),
    due: num(invoice.amountDue),
    staffName: invoice.createdBy?.name ?? null,
  }));

  return {
    range,
    rows,
    totals: rows.reduce(
      (acc, row) => ({
        subtotal: acc.subtotal + row.subtotal,
        tax: acc.tax + row.taxAmount,
        total: acc.total + row.total,
        paid: acc.paid + row.paid,
        due: acc.due + row.due,
      }),
      { subtotal: 0, tax: 0, total: 0, paid: 0, due: 0 },
    ),
  };
}

export async function purchaseReport(
  user: SessionUser,
  options: { preset?: ReportPreset; from?: string; to?: string; branchId?: string; supplierId?: string },
) {
  const firmId = requireFirmId(user);
  const scope = resolveBranchScope(user, options.branchId ?? null);
  const range = reportRange(options.preset ?? "this_month", options.from, options.to);
  const tm = taxModeWhere(user);

  const invoices = await prisma.purchaseInvoice.findMany({
    where: {
      firmId,
      status: { not: "CANCELLED" },
      invoiceDate: { gte: range.from, lte: range.to },
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      ...(options.supplierId ? { supplierId: options.supplierId } : {}),
      ...tm,
    },
    include: { supplier: { select: { name: true } } },
    orderBy: { invoiceDate: "desc" },
  });

  const rows = invoices.map((invoice) => ({
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    supplierName: invoice.supplier.name,
    supplierRef: invoice.supplierRef,
    subtotal: num(invoice.subtotal),
    taxAmount: num(invoice.cgstAmount) + num(invoice.sgstAmount) + num(invoice.igstAmount),
    total: num(invoice.total),
    paid: num(invoice.amountPaid),
  }));

  return {
    range,
    rows,
    totals: rows.reduce(
      (acc, row) => ({
        subtotal: acc.subtotal + row.subtotal,
        tax: acc.tax + row.taxAmount,
        total: acc.total + row.total,
        paid: acc.paid + row.paid,
      }),
      { subtotal: 0, tax: 0, total: 0, paid: 0 },
    ),
  };
}

export interface GstSummaryLine {
  gstRate: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

/** GST summary grouped by rate — GST mode only (enforced by the caller). */
export async function gstSummaryReport(
  user: SessionUser,
  options: { preset?: ReportPreset; from?: string; to?: string; branchId?: string },
): Promise<{ range: DateRange; byRate: GstSummaryLine[]; totals: GstSummaryLine; invoices: { invoiceNumber: string; date: Date; taxable: number; cgst: number; sgst: number; igst: number; total: number }[] }> {
  const firmId = requireFirmId(user);
  const scope = resolveBranchScope(user, options.branchId ?? null);
  const range = reportRange(options.preset ?? "this_month", options.from, options.to);

  const invoices = await prisma.invoice.findMany({
    where: {
      firmId,
      taxMode: "GST",
      status: { not: "CANCELLED" },
      invoiceDate: { gte: range.from, lte: range.to },
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
    },
    include: { lines: { select: { gstRate: true, taxableValue: true, cgstAmount: true, sgstAmount: true, igstAmount: true, lineTotal: true } } },
    orderBy: { invoiceDate: "desc" },
  });

  const byRate = new Map<number, GstSummaryLine>();
  const invoiceRows: { invoiceNumber: string; date: Date; taxable: number; cgst: number; sgst: number; igst: number; total: number }[] = [];

  for (const invoice of invoices) {
    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    for (const line of invoice.lines) {
      const rate = num(line.gstRate);
      const entry = byRate.get(rate) ?? { gstRate: rate, taxableAmount: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
      entry.taxableAmount += num(line.taxableValue);
      entry.cgst += num(line.cgstAmount);
      entry.sgst += num(line.sgstAmount);
      entry.igst += num(line.igstAmount);
      entry.total += num(line.lineTotal);
      byRate.set(rate, entry);
      taxable += num(line.taxableValue);
      cgst += num(line.cgstAmount);
      sgst += num(line.sgstAmount);
      igst += num(line.igstAmount);
    }
    invoiceRows.push({
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.invoiceDate,
      taxable,
      cgst,
      sgst,
      igst,
      total: num(invoice.totalAmount),
    });
  }

  const rateRows = [...byRate.values()].sort((a, b) => a.gstRate - b.gstRate);
  const totals = rateRows.reduce(
    (acc, row) => ({
      gstRate: 0,
      taxableAmount: acc.taxableAmount + row.taxableAmount,
      cgst: acc.cgst + row.cgst,
      sgst: acc.sgst + row.sgst,
      igst: acc.igst + row.igst,
      total: acc.total + row.total,
    }),
    { gstRate: 0, taxableAmount: 0, cgst: 0, sgst: 0, igst: 0, total: 0 },
  );

  return { range, byRate: rateRows, totals, invoices: invoiceRows };
}

/** Product-wise sales between the dates (quantities + revenue). */
export async function productSalesReport(
  user: SessionUser,
  options: { preset?: ReportPreset; from?: string; to?: string; branchId?: string },
) {
  const firmId = requireFirmId(user);
  const scope = resolveBranchScope(user, options.branchId ?? null);
  const range = reportRange(options.preset ?? "this_month", options.from, options.to);

  const lines = await prisma.invoiceLine.findMany({
    where: {
      invoice: {
        firmId,
        status: { not: "CANCELLED" },
        invoiceDate: { gte: range.from, lte: range.to },
        ...(scope.branchId ? { branchId: scope.branchId } : {}),
        ...taxModeWhere(user),
      },
    },
    include: {
      product: { select: { name: true, sku: true, category: { select: { name: true } } } },
    },
  });

  const byProduct = new Map<string, { name: string; sku: string; category: string | null; quantity: number; revenue: number }>();
  for (const line of lines) {
    const entry = byProduct.get(line.productId) ?? {
      name: line.product.name,
      sku: line.product.sku,
      category: line.product.category?.name ?? null,
      quantity: 0,
      revenue: 0,
    };
    entry.quantity += line.quantity;
    entry.revenue += num(line.lineTotal);
    byProduct.set(line.productId, entry);
  }

  return [...byProduct.values()].sort((a, b) => b.revenue - a.revenue);
}

export async function financialSummary(
  user: SessionUser,
  options: { preset?: ReportPreset; from?: string; to?: string; branchId?: string },
) {
  const firmId = requireFirmId(user);
  const scope = resolveBranchScope(user, options.branchId ?? null);
  const range = reportRange(options.preset ?? "this_month", options.from, options.to);
  const branchWhere = scope.branchId ? { branchId: scope.branchId } : {};
  const tm = taxModeWhere(user);

  const [sales, purchases, expenses, receivablesAgg, payablesAgg] = await Promise.all([
    prisma.invoice.aggregate({
      where: { firmId, status: { not: "CANCELLED" }, invoiceDate: { gte: range.from, lte: range.to }, ...branchWhere, ...tm },
      _sum: { totalAmount: true, amountPaid: true, cgstAmount: true, sgstAmount: true, igstAmount: true },
    }),
    prisma.purchaseInvoice.aggregate({
      where: { firmId, status: { not: "CANCELLED" }, invoiceDate: { gte: range.from, lte: range.to }, ...branchWhere, ...tm },
      _sum: { total: true, amountPaid: true },
    }),
    prisma.expense.aggregate({
      where: { firmId, status: { not: "REJECTED" }, expenseDate: { gte: range.from, lte: range.to }, ...branchWhere },
      _sum: { amount: true },
    }),
    prisma.customer.aggregate({
      where: { firmId, ...branchWhere },
      _sum: { outstandingAmount: true },
    }),
    prisma.supplier.aggregate({
      where: { firmId },
      _sum: { outstandingAmount: true },
    }),
  ]);

  const revenue = num(sales._sum.totalAmount);
  const taxCollected =
    num(sales._sum.cgstAmount) + num(sales._sum.sgstAmount) + num(sales._sum.igstAmount);
  const cogs = num(purchases._sum.total);
  const expenseTotal = num(expenses._sum.amount);

  return {
    range,
    revenue,
    taxCollected,
    netRevenue: revenue - taxCollected,
    purchases: cogs,
    expenses: expenseTotal,
    grossMargin: revenue - taxCollected - cogs,
    receivables: num(receivablesAgg._sum.outstandingAmount),
    payables: num(payablesAgg._sum.outstandingAmount),
    collected: num(sales._sum.amountPaid),
  };
}

export async function outstandingReport(user: SessionUser) {
  const firmId = requireFirmId(user);
  const [customers, suppliers] = await Promise.all([
    prisma.customer.findMany({
      where: { firmId, outstandingAmount: { gt: 0 } },
      select: { id: true, name: true, phone: true, outstandingAmount: true, creditLimit: true },
      orderBy: { outstandingAmount: "desc" },
      take: 100,
    }),
    prisma.supplier.findMany({
      where: { firmId, outstandingAmount: { gt: 0 } },
      select: { id: true, name: true, outstandingAmount: true },
      orderBy: { outstandingAmount: "desc" },
      take: 100,
    }),
  ]);
  return {
    customers: customers.map((c) => ({ ...c, outstandingAmount: num(c.outstandingAmount), creditLimit: num(c.creditLimit) })),
    suppliers: suppliers.map((s) => ({ ...s, outstandingAmount: num(s.outstandingAmount) })),
  };
}
