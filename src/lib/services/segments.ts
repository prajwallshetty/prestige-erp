import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { CustomerType } from "@/generated/prisma/enums";
import { requireFirmId, type SessionUser } from "@/lib/session";

/**
 * Customer segmentation over the existing customer master (no second customer
 * table). Purchase history comes from the invoice rollups already stored on the
 * customer and from invoice lines; interests come from the product-interest
 * tags captured on leads.
 */
export interface SegmentFilters {
  q?: string;
  city?: string;
  type?: string;
  /** active = bought in the last 90 days, lapsed = last purchase over 180 days ago, never = no invoice */
  recency?: string;
  minBilled?: string;
  categoryId?: string;
  interest?: string;
}

const CUSTOMER_TYPES = ["RETAIL", "BUSINESS", "DEALER", "CORPORATE", "OTHER"];

export async function getSegment(user: SessionUser, filters: SegmentFilters, options: { includeCustomers: boolean }) {
  const firmId = requireFirmId(user);
  const and: Prisma.CustomerWhereInput[] = [{ firmId, isActive: true }];

  if (filters.q?.trim()) {
    and.push({ OR: [{ name: { contains: filters.q.trim(), mode: "insensitive" } }, { company: { contains: filters.q.trim(), mode: "insensitive" } }] });
  }
  if (filters.city) and.push({ city: { equals: filters.city, mode: "insensitive" } });
  if (filters.type && CUSTOMER_TYPES.includes(filters.type)) and.push({ type: filters.type as CustomerType });
  if (filters.recency === "active") and.push({ lastInvoiceAt: { gte: new Date(Date.now() - 90 * 86_400_000) } });
  if (filters.recency === "lapsed") and.push({ lastInvoiceAt: { lt: new Date(Date.now() - 180 * 86_400_000) } });
  if (filters.recency === "never") and.push({ lastInvoiceAt: null });
  const minBilled = Number(filters.minBilled);
  if (Number.isFinite(minBilled) && minBilled > 0) and.push({ totalBilled: { gte: minBilled } });
  if (filters.categoryId) {
    and.push({ invoices: { some: { status: { not: "CANCELLED" }, lines: { some: { product: { categoryId: filters.categoryId } } } } } });
  }
  if (filters.interest) {
    const rows = await prisma.$queryRaw<{ customerId: string }[]>`
      SELECT DISTINCT "customerId" FROM "leads"
      WHERE "firmId" = ${firmId} AND "customerId" IS NOT NULL
        AND EXISTS (SELECT 1 FROM unnest("productInterests") AS tag WHERE lower(tag) = lower(${filters.interest}))`;
    and.push({ id: { in: rows.map((r) => r.customerId) } });
  }
  const where: Prisma.CustomerWhereInput = { AND: and };

  const [aggregate, customers] = await Promise.all([
    prisma.customer.aggregate({ where, _count: true, _sum: { totalBilled: true, outstandingAmount: true } }),
    options.includeCustomers
      ? prisma.customer.findMany({
          where,
          orderBy: { totalBilled: "desc" },
          take: 100,
          select: { id: true, code: true, name: true, phone: true, city: true, type: true, totalBilled: true, outstandingAmount: true, lastInvoiceAt: true, invoiceCount: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    count: aggregate._count,
    totalBilled: Number(aggregate._sum.totalBilled ?? 0),
    outstanding: Number(aggregate._sum.outstandingAmount ?? 0),
    customers,
  };
}

export async function getSegmentOptions(user: SessionUser) {
  const firmId = requireFirmId(user);
  const [cities, categories, interests] = await Promise.all([
    prisma.customer.groupBy({ by: ["city"], where: { firmId, city: { not: null } }, _count: true, orderBy: { _count: { city: "desc" } }, take: 40 }),
    prisma.category.findMany({ where: { firmId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.$queryRaw<{ tag: string; n: bigint }[]>`
      SELECT lower(tag) AS tag, count(*) AS n FROM "leads", unnest("productInterests") AS tag
      WHERE "firmId" = ${firmId} GROUP BY lower(tag) ORDER BY n DESC LIMIT 30`,
  ]);
  return {
    cities: cities.filter((c) => c.city).map((c) => c.city!),
    categories,
    interests: interests.map((i) => i.tag),
  };
}
