import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { resolveBranchScope, requireFirmId, taxModeWhere } from "@/lib/session";
import { num } from "@/lib/money";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Invoice list query shared by /invoices and the CSV export.
 * Firm- and branch-scoped from the session; filters are server-validated.
 */
export interface InvoiceFilters {
  status?: string;
  kind?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function listInvoices(user: SessionUser, filters: InvoiceFilters) {
  const firmId = requireFirmId(user);
  const scope = resolveBranchScope(user, null);
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, filters.pageSize ?? 25));

  const where: Prisma.InvoiceWhereInput = {
    firmId,
    ...taxModeWhere(user),
    ...(scope.branchId ? { branchId: scope.branchId } : {}),
    ...(filters.status && filters.status !== "all" ? { status: filters.status as never } : {}),
    ...(filters.kind === "GST" ? { kind: "TAX_INVOICE" } : {}),
    ...(filters.kind === "NON_GST" ? { kind: "NON_GST_BILL" } : {}),
    ...(filters.q
      ? {
          OR: [
            { invoiceNumber: { contains: filters.q, mode: "insensitive" } },
            { billToName: { contains: filters.q, mode: "insensitive" } },
            { billToPhone: { contains: filters.q } },
          ],
        }
      : {}),
    ...(filters.from || filters.to
      ? {
          invoiceDate: {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };

  const [total, invoices] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: { invoiceDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        invoiceNumber: true,
        kind: true,
        taxMode: true,
        status: true,
        invoiceDate: true,
        billToName: true,
        billToPhone: true,
        totalAmount: true,
        amountPaid: true,
        amountDue: true,
        branch: { select: { name: true } },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      kind: invoice.kind,
      taxMode: invoice.taxMode,
      status: invoice.status as string,
      invoiceDate: invoice.invoiceDate,
      customerName: invoice.billToName,
      customerPhone: invoice.billToPhone,
      branchName: invoice.branch.name,
      total: num(invoice.totalAmount),
      paid: num(invoice.amountPaid),
      due: num(invoice.amountDue),
    })),
  };
}
