import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";

type Db = Prisma.TransactionClient | typeof prisma;

export interface StockTarget {
  productId: string;
  variantId?: string | null;
}

/**
 * Transaction-driven stock level. Computed from StockTransaction rows so no
 * code path can mutate stock silently — the handover forbids "random manual
 * stock changes without an inventory transaction/audit entry".
 */
export async function getStockLevel(
  firmId: string,
  branchId: string,
  target: StockTarget,
  db: Db = prisma,
): Promise<number> {
  const aggregate = await db.stockTransaction.aggregate({
    where: {
      firmId,
      branchId,
      productId: target.productId,
      variantId: target.variantId ?? null,
    },
    _sum: { quantity: true },
  });
  return aggregate._sum.quantity ?? 0;
}

export async function getStockLevelsForProducts(
  firmId: string,
  branchId: string,
  productIds: string[],
  db: Db = prisma,
): Promise<Map<string, number>> {
  const empty = new Map<string, number>();
  if (productIds.length === 0) return empty;
  const rows = await db.stockTransaction.groupBy({
    by: ["productId"],
    where: { firmId, branchId, productId: { in: productIds } },
    _sum: { quantity: true },
  });
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.productId, row._sum.quantity ?? 0);
  return map;
}

/** Stock across all branches for a product (per-branch breakdown). */
export async function getStockByBranch(
  firmId: string,
  target: StockTarget,
  db: Db = prisma,
): Promise<Map<string, number>> {
  const rows = await db.stockTransaction.groupBy({
    by: ["branchId"],
    where: {
      firmId,
      productId: target.productId,
      variantId: target.variantId ?? null,
    },
    _sum: { quantity: true },
  });
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.branchId, row._sum.quantity ?? 0);
  return map;
}

/**
 * Writes a stock transaction. All stock mutations funnel through here so the
 * ledger is complete and auditable.
 */
export async function writeStockTransaction(
  db: Db,
  input: {
    firmId: string;
    branchId: string;
    productId: string;
    variantId?: string | null;
    type:
      | "OPENING"
      | "PURCHASE_IN"
      | "SALE_OUT"
      | "SALE_RETURN_IN"
      | "PURCHASE_RETURN_OUT"
      | "TRANSFER_OUT"
      | "TRANSFER_IN"
      | "ADJUST_IN"
      | "ADJUST_OUT"
      | "DAMAGE_OUT";
    quantity: number; // signed
    unitCost?: number | null;
    reference?: string | null;
    documentType?: string | null;
    documentId?: string | null;
    notes?: string | null;
    userId?: string | null;
  },
): Promise<void> {
  if (input.quantity === 0) return;
  const balanceAfter = await getStockLevel(
    input.firmId,
    input.branchId,
    { productId: input.productId, variantId: input.variantId },
    db,
  );
  const next = balanceAfter + input.quantity;
  if (next < 0) {
    throw new BusinessRuleError(
      `Insufficient stock: this move would take the level to ${next}.`,
    );
  }
  await db.stockTransaction.create({
    data: {
      firmId: input.firmId,
      branchId: input.branchId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      type: input.type,
      quantity: input.quantity,
      balanceAfter: next,
      unitCost: input.unitCost ?? null,
      reference: input.reference ?? null,
      documentType: input.documentType ?? null,
      documentId: input.documentId ?? null,
      notes: input.notes ?? null,
      userId: input.userId ?? null,
    },
  });
}

/** Validates a product belongs to the caller's firm before any mutation. */
export async function requireProduct(
  firmId: string,
  productId: string,
  db: Db = prisma,
) {
  const product = await db.product.findFirst({
    where: { id: productId, firmId },
  });
  if (!product) throw new NotFoundError("Product not found");
  return product;
}

/**
 * Serial-number helpers. Tracked products must always reference exact serials
 * on sale and return.
 */
export async function findSerialUnits(
  firmId: string,
  serialNumbers: string[],
  db: Db = prisma,
) {
  const cleaned = serialNumbers.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return [];
  return db.serialUnit.findMany({
    where: { firmId, serialNumber: { in: cleaned } },
  });
}

export async function assertSerialsAvailableForSale(
  firmId: string,
  productId: string,
  branchId: string,
  serialNumbers: string[],
  db: Db = prisma,
): Promise<void> {
  const units = await findSerialUnits(firmId, serialNumbers, db);
  if (units.length !== serialNumbers.filter((s) => s.trim()).length) {
    throw new BusinessRuleError("One or more serial numbers do not exist in this system");
  }
  for (const unit of units) {
    if (unit.productId !== productId) {
      throw new BusinessRuleError(
        `Serial ${unit.serialNumber} belongs to a different product`,
      );
    }
    if (unit.branchId !== branchId) {
      const home = await db.branch.findUnique({
        where: { id: unit.branchId },
        select: { name: true },
      });
      throw new BusinessRuleError(
        `Serial ${unit.serialNumber} is stocked at ${home?.name ?? "another branch"} — sell it from there or transfer it first`,
      );
    }
    if (unit.status === "SOLD") {
      throw new BusinessRuleError(`Serial ${unit.serialNumber} is already sold`);
    }
    if (unit.status !== "IN_STOCK" && unit.status !== "RETURNED") {
      throw new BusinessRuleError(
        `Serial ${unit.serialNumber} is not available for sale (${unit.status})`,
      );
    }
  }
}

export async function assertSerialsOwnedByCustomer(
  firmId: string,
  invoiceId: string,
  serialNumbers: string[],
  db: Db = prisma,
): Promise<void> {
  const units = await findSerialUnits(firmId, serialNumbers, db);
  const supplied = serialNumbers.filter((s) => s.trim()).length;
  if (units.length !== supplied) {
    throw new BusinessRuleError("One or more serial numbers do not exist in this system");
  }
  for (const unit of units) {
    if (unit.soldInvoiceId !== invoiceId) {
      throw new BusinessRuleError(
        `Serial ${unit.serialNumber} was not sold on this invoice`,
      );
    }
    if (unit.status !== "SOLD") {
      throw new BusinessRuleError(
        `Serial ${unit.serialNumber} is not currently marked as sold`,
      );
    }
  }
}

export async function assertSerialsInStockForPurchaseReturn(
  firmId: string,
  branchId: string,
  serialNumbers: string[],
  db: Db = prisma,
): Promise<void> {
  const units = await findSerialUnits(firmId, serialNumbers, db);
  const supplied = serialNumbers.filter((s) => s.trim()).length;
  if (units.length !== supplied) {
    throw new BusinessRuleError("One or more serial numbers do not exist in this system");
  }
  for (const unit of units) {
    if (unit.branchId !== branchId) {
      const home = await db.branch.findUnique({
        where: { id: unit.branchId },
        select: { name: true },
      });
      throw new BusinessRuleError(
        `Serial ${unit.serialNumber} is stocked at ${home?.name ?? "another branch"} — sell it from there or transfer it first`,
      );
    }
    if (unit.status === "SOLD") {
      throw new BusinessRuleError(
        `Serial ${unit.serialNumber} has been sold and cannot be returned to the supplier`,
      );
    }
  }
}

/**
 * Applies a status + history transition to serial units inside an existing
 * transaction. Serial history rows form the append-only lifecycle ledger:
 * Purchase → Stock → Sale → Customer → Warranty.
 */
export async function transitionSerialUnits(
  db: Db,
  input: {
    firmId: string;
    serialUnitIds: string[];
    eventType:
      | "PURCHASE_IN"
      | "STOCK_IN"
      | "SOLD"
      | "SALE_RETURNED"
      | "PURCHASE_RETURNED"
      | "TRANSFERRED_OUT"
      | "TRANSFERRED_IN"
      | "ADJUSTED"
      | "DAMAGED"
      | "WARRANTY_CLAIMED"
      | "WARRANTY_REPLACED";
    toStatus: "IN_STOCK" | "SOLD" | "RETURNED" | "DAMAGED" | "WARRANTY";
    fromStatus?: string | null;
    reference?: string | null;
    documentId?: string | null;
    note?: string | null;
    userId?: string | null;
  },
): Promise<void> {
  if (input.serialUnitIds.length === 0) return;
  const units = await db.serialUnit.findMany({
    where: { id: { in: input.serialUnitIds }, firmId: input.firmId },
    select: { id: true, status: true },
  });
  for (const unit of units) {
    await db.serialUnit.update({
      where: { id: unit.id },
      data: {
        status: input.toStatus,
        ...(input.eventType === "SOLD" ? { soldAt: new Date() } : {}),
        ...(input.eventType === "SALE_RETURNED" ? { soldInvoiceId: null, soldInvoiceLineId: null } : {}),
      },
    });
    await db.serialHistory.create({
      data: {
        serialUnitId: unit.id,
        eventType: input.eventType,
        fromStatus: unit.status,
        toStatus: input.toStatus,
        reference: input.reference ?? null,
        documentId: input.documentId ?? null,
        note: input.note ?? null,
        userId: input.userId ?? null,
      },
    });
  }
}

/** Purchase price used for stock valuation: latest known unit cost. */
export async function latestUnitCost(
  firmId: string,
  productId: string,
  db: Db = prisma,
): Promise<number | null> {
  const txn = await db.stockTransaction.findFirst({
    where: { firmId, productId, unitCost: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { unitCost: true },
  });
  return txn?.unitCost ? Number(txn.unitCost) : null;
}
