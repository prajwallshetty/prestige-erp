import "server-only";

import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { resolveBranchScope, requireFirmId, taxModeWhere } from "@/lib/session";
import { num } from "@/lib/money";
import { todayRange } from "@/lib/dates";
import { financialYearFor } from "@/lib/sequence";

/**
 * Dashboard metrics — role-aware and scoped to the user's firm and branch.
 * All figures are firm- and branch-scoped from the session.
 */

export interface DashboardMetrics {
  todaySales: number;
  todaySalesCount: number;
  todayPurchases: number;
  receivables: number;
  payables: number;
  lowStock: number;
  outOfStock: number;
  expensesThisMonth: number;
  profitThisMonth: number | null;
  salesSeries: { date: string; sales: number; purchases: number }[];
  recentInvoices: {
    id: string;
    invoiceNumber: string;
    kind: string;
    customerName: string;
    total: number;
    due: number;
    status: string;
    date: Date;
  }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
}

export async function dashboardMetrics(
  user: SessionUser,
): Promise<DashboardMetrics> {
  const firmId = requireFirmId(user);
  const scope = resolveBranchScope(user, null);
  const branchWhere = scope.branchId ? { branchId: scope.branchId } : {};
  const tm = taxModeWhere(user);
  const today = todayRange();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [todaySalesAgg, todayPurchasesAgg, receivablesAgg, payablesAgg, lowStockCount, outOfStockCount, monthExpensesAgg, monthPurchasesAgg] =
    await Promise.all([
      prisma.invoice.aggregate({
        where: { firmId, status: { not: "CANCELLED" }, invoiceDate: { gte: today.from, lte: today.to }, ...branchWhere, ...tm },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      prisma.purchaseInvoice.aggregate({
        where: { firmId, status: { not: "CANCELLED" }, invoiceDate: { gte: today.from, lte: today.to }, ...branchWhere, ...tm },
        _sum: { total: true },
      }),
      prisma.customer.aggregate({ where: { firmId }, _sum: { outstandingAmount: true } }),
      prisma.supplier.aggregate({ where: { firmId }, _sum: { outstandingAmount: true } }),
      prisma.product.count({ where: { firmId, status: "ACTIVE", lowStockQty: { gt: 0 }, ...branchWhere } }),
      prisma.stockTransaction.groupBy({
        by: ["productId"],
        where: { firmId, ...branchWhere },
        _sum: { quantity: true },
      }),
      prisma.expense.aggregate({
        where: { firmId, status: { not: "REJECTED" }, expenseDate: { gte: monthStart }, ...branchWhere },
        _sum: { amount: true },
      }),
      prisma.purchaseInvoice.aggregate({
        where: { firmId, status: { not: "CANCELLED" }, invoiceDate: { gte: monthStart }, ...branchWhere, ...tm },
        _sum: { total: true },
      }),
    ]);

  // 30-day sales + purchase series for the graphs.
  const since = new Date();
  since.setDate(since.getDate() - 29);
  since.setHours(0, 0, 0, 0);

  const [salesRows, purchaseRows] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["invoiceDate"],
      where: { firmId, status: { not: "CANCELLED" }, invoiceDate: { gte: since }, ...branchWhere, ...tm },
      _sum: { totalAmount: true },
    }),
    prisma.purchaseInvoice.groupBy({
      by: ["invoiceDate"],
      where: { firmId, status: { not: "CANCELLED" }, invoiceDate: { gte: since }, ...branchWhere, ...tm },
      _sum: { total: true },
    }),
  ]);

  const dayKey = (date: Date) => date.toISOString().slice(0, 10);
  const salesByDay = new Map<string, number>();
  for (const row of salesRows) {
    const key = dayKey(row.invoiceDate);
    salesByDay.set(key, (salesByDay.get(key) ?? 0) + num(row._sum.totalAmount));
  }
  const purchasesByDay = new Map<string, number>();
  for (const row of purchaseRows) {
    const key = dayKey(row.invoiceDate);
    purchasesByDay.set(key, (purchasesByDay.get(key) ?? 0) + num(row._sum.total));
  }

  const salesSeries: { date: string; sales: number; purchases: number }[] = [];
  for (let i = 29; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const key = dayKey(date);
    salesSeries.push({
      date: key,
      sales: salesByDay.get(key) ?? 0,
      purchases: purchasesByDay.get(key) ?? 0,
    });
  }

  const recentInvoices = await prisma.invoice.findMany({
    where: { firmId, ...branchWhere, ...tm },
    orderBy: { invoiceDate: "desc" },
    take: 8,
    select: {
      id: true,
      invoiceNumber: true,
      kind: true,
      billToName: true,
      totalAmount: true,
      amountDue: true,
      status: true,
      invoiceDate: true,
    },
  });

  // Top products this month (by revenue).
  const monthLines = await prisma.invoiceLine.findMany({
    where: {
      invoice: {
        firmId,
        status: { not: "CANCELLED" },
        invoiceDate: { gte: monthStart },
        ...(scope.branchId ? { branchId: scope.branchId } : {}),
        ...tm,
      },
    },
    include: { product: { select: { name: true } } },
  });
  const byProduct = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const line of monthLines) {
    const entry = byProduct.get(line.productId) ?? { name: line.product.name, quantity: 0, revenue: 0 };
    entry.quantity += line.quantity;
    entry.revenue += num(line.lineTotal);
    byProduct.set(line.productId, entry);
  }
  const topProducts = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6);

  const outOfStock = outOfStockCount.filter((row) => (row._sum.quantity ?? 0) <= 0).length;
  const expensesThisMonth = num(monthExpensesAgg._sum.amount);
  const revenueThisMonth = salesSeries.reduce((sum, day) => sum + day.sales, 0);
  const profitThisMonth = revenueThisMonth - num(monthPurchasesAgg._sum.total) - expensesThisMonth;

  return {
    todaySales: num(todaySalesAgg._sum.totalAmount),
    todaySalesCount: todaySalesAgg._count._all,
    todayPurchases: num(todayPurchasesAgg._sum.total),
    receivables: num(receivablesAgg._sum.outstandingAmount),
    payables: num(payablesAgg._sum.outstandingAmount),
    lowStock: lowStockCount,
    outOfStock,
    expensesThisMonth,
    profitThisMonth,
    salesSeries,
    recentInvoices: recentInvoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      kind: invoice.kind,
      customerName: invoice.billToName,
      total: num(invoice.totalAmount),
      due: num(invoice.amountDue),
      status: invoice.status,
      date: invoice.invoiceDate,
    })),
    topProducts,
  };
}

export { financialYearFor };
