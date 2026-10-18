import "server-only";

import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { nextDocumentNumber, DOCUMENT_TYPES } from "@/lib/sequence";
import { recordAudit } from "@/lib/audit";
import {
  getStockLevel,
  requireProduct,
  transitionSerialUnits,
  writeStockTransaction,
} from "@/lib/services/inventory";

/**
 * Stock adjustments (Increase / Decrease / Damage / Lost / Correction) and
 * stock transfers (DRAFT → REQUESTED → APPROVED → IN_TRANSIT → RECEIVED).
 * Stock only ever moves through the workflow — never by direct mutation.
 */

export type AdjustmentType = "INCREASE" | "DECREASE" | "DAMAGE" | "LOST" | "CORRECTION";

const ADJUSTMENT_SIGNS: Record<AdjustmentType, 1 | -1> = {
  INCREASE: 1,
  DECREASE: -1,
  DAMAGE: -1,
  LOST: -1,
  CORRECTION: -1, // sign flips based on target vs current below
};

export async function createStockAdjustment(input: {
  firmId: string;
  branchId: string;
  productId: string;
  variantId?: string | null;
  type: AdjustmentType;
  quantity: number;
  reason: string;
  reference?: string | null;
  userId?: string | null;
}) {
  if (input.quantity <= 0) throw new BusinessRuleError("Quantity must be greater than zero");
  if (!input.reason.trim()) throw new BusinessRuleError("A reason is required for every adjustment");
  const product = await requireProduct(input.firmId, input.productId);

  const current = await getStockLevel(input.firmId, input.branchId, {
    productId: input.productId,
    variantId: input.variantId ?? null,
  });

  let signedDelta: number;
  if (input.type === "INCREASE") {
    signedDelta = input.quantity;
  } else if (input.type === "CORRECTION") {
    signedDelta = input.quantity - current;
  } else {
    signedDelta = -input.quantity;
  }

  if (current + signedDelta < 0) {
    throw new BusinessRuleError(
      `Insufficient stock: only ${current} unit${current === 1 ? "" : "s"} available`,
    );
  }

  const adjustmentNumber = await nextDocumentNumber(input.firmId, "stock_adjustment", "NON_GST");

  return prisma.$transaction(async (tx) => {
    const adjustment = await tx.stockAdjustment.create({
      data: {
        adjustmentNumber,
        firmId: input.firmId,
        branchId: input.branchId,
        productId: input.productId,
        variantId: input.variantId ?? null,
        type: input.type,
        reason: input.reason,
        reference: input.reference ?? null,
        quantity: signedDelta,
        unitCost: Number(product.purchasePrice) || null,
        createdById: input.userId ?? null,
      },
    });

    await writeStockTransaction(tx, {
      firmId: input.firmId,
      branchId: input.branchId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      type:
        input.type === "INCREASE"
          ? "ADJUST_IN"
          : input.type === "DAMAGE"
            ? "DAMAGE_OUT"
            : "ADJUST_OUT",
      quantity: signedDelta,
      reference: adjustmentNumber,
      documentType: "STOCK_ADJUSTMENT",
      documentId: adjustment.id,
      notes: input.reason,
      userId: input.userId ?? null,
    });

    await recordAudit({
      action: "STOCK_ADJUSTED",
      entity: "StockAdjustment",
      entityId: adjustment.id,
      summary: `${adjustmentNumber} · ${product.name} ${signedDelta > 0 ? "+" : ""}${signedDelta} (${input.type.toLowerCase()})`,
      firmId: input.firmId,
      branchId: input.branchId,
      userId: input.userId,
      after: { quantity: signedDelta, reason: input.reason },
    });

    return adjustment;
  });
}

// ---------------------------------------------------------------------------
// Stock transfers
// ---------------------------------------------------------------------------

export async function createStockTransfer(input: {
  firmId: string;
  fromBranchId: string;
  toBranchId: string;
  notes?: string | null;
  lines: { productId: string; variantId?: string | null; quantity: number; serialNumbers?: string[] }[];
  userId?: string | null;
}) {
  if (input.fromBranchId === input.toBranchId) {
    throw new BusinessRuleError("Source and destination branches must differ");
  }
  if (input.lines.length === 0) throw new BusinessRuleError("Add at least one line item");
  for (const line of input.lines) {
    if (line.quantity <= 0) throw new BusinessRuleError("Quantity must be greater than zero");
  }

  const transferNumber = await nextDocumentNumber(input.firmId, DOCUMENT_TYPES.STOCK_TRANSFER, "NON_GST");

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.create({
      data: {
        transferNumber,
        firmId: input.firmId,
        fromBranchId: input.fromBranchId,
        toBranchId: input.toBranchId,
        status: "DRAFT",
        notes: input.notes ?? null,
        createdById: input.userId ?? null,
        lines: {
          create: input.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId ?? null,
            quantity: line.quantity,
            serialNumbers: (line.serialNumbers ?? []).filter(Boolean).join("\n") || null,
          })),
        },
      },
    });

    await recordAudit({
      action: "STOCK_TRANSFERRED",
      entity: "StockTransfer",
      entityId: transfer.id,
      summary: `${transferNumber} (created)`,
      firmId: input.firmId,
      branchId: input.fromBranchId,
      userId: input.userId,
    });

    return transfer;
  });
}

/**
 * Advance a transfer through its workflow. Stock leaves the source branch at
 * dispatch (IN_TRANSIT) and arrives at the destination at receipt (RECEIVED) —
 * each leg a proper StockTransaction. Cancel is allowed until dispatch and
 * reverses nothing because stock has not moved yet.
 */
export async function advanceStockTransfer(input: {
  firmId: string;
  transferId: string;
  action: "request" | "approve" | "dispatch" | "receive" | "cancel";
  note?: string | null;
  userId?: string | null;
}) {
  const transfer = await prisma.stockTransfer.findFirst({
    where: { id: input.transferId, firmId: input.firmId },
    include: { lines: true },
  });
  if (!transfer) throw new NotFoundError("Stock transfer not found");

  const transitions: Record<string, { from: string[]; to: string }> = {
    request: { from: ["DRAFT"], to: "REQUESTED" },
    approve: { from: ["REQUESTED"], to: "APPROVED" },
    dispatch: { from: ["APPROVED"], to: "IN_TRANSIT" },
    receive: { from: ["IN_TRANSIT"], to: "RECEIVED" },
    cancel: { from: ["DRAFT", "REQUESTED", "APPROVED"], to: "CANCELLED" },
  };
  const rule = transitions[input.action];
  if (!rule.from.includes(transfer.status)) {
    throw new BusinessRuleError(
      `Cannot ${input.action} a transfer that is ${transfer.status.toLowerCase().replace("_", " ")}`,
    );
  }

  return prisma.$transaction(async (tx) => {
    // Stock legs.
    if (input.action === "dispatch") {
      for (const line of transfer.lines) {
        const available = await getStockLevel(input.firmId, transfer.fromBranchId, {
          productId: line.productId,
          variantId: line.variantId,
        }, tx);
        if (available < line.quantity) {
          throw new BusinessRuleError(
            `Insufficient stock at the source branch for one of the items (${available} available)`,
          );
        }
      }
      for (const line of transfer.lines) {
        await writeStockTransaction(tx, {
          firmId: input.firmId,
          branchId: transfer.fromBranchId,
          productId: line.productId,
          variantId: line.variantId,
          type: "TRANSFER_OUT",
          quantity: -line.quantity,
          reference: transfer.transferNumber,
          documentType: "STOCK_TRANSFER",
          documentId: transfer.id,
          userId: input.userId ?? null,
        });
      }
    }

    if (input.action === "receive") {
      for (const line of transfer.lines) {
        await writeStockTransaction(tx, {
          firmId: input.firmId,
          branchId: transfer.toBranchId,
          productId: line.productId,
          variantId: line.variantId,
          type: "TRANSFER_IN",
          quantity: line.quantity,
          reference: transfer.transferNumber,
          documentType: "STOCK_TRANSFER",
          documentId: transfer.id,
          userId: input.userId ?? null,
        });
        // Serialized units move physically too.
        if (line.serialNumbers) {
          const serials = line.serialNumbers.split("\n").filter(Boolean);
          const units = await tx.serialUnit.findMany({
            where: { firmId: input.firmId, serialNumber: { in: serials } },
            select: { id: true },
          });
          await transitionSerialUnits(tx, {
            firmId: input.firmId,
            serialUnitIds: units.map((u) => u.id),
            eventType: "TRANSFERRED_IN",
            toStatus: "IN_STOCK",
            reference: transfer.transferNumber,
            userId: input.userId ?? null,
          });
          for (const unit of units) {
            await tx.serialUnit.update({
              where: { id: unit.id },
              data: { branchId: transfer.toBranchId },
            });
          }
        }
      }
    }

    const updated = await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: rule.to as never,
        ...(input.action === "dispatch" ? { dispatchedAt: new Date(), dispatchNote: input.note ?? null } : {}),
        ...(input.action === "receive" ? { receivedAt: new Date(), receivedNote: input.note ?? null } : {}),
      },
    });

    await recordAudit({
      action: "STOCK_TRANSFERRED",
      entity: "StockTransfer",
      entityId: transfer.id,
      summary: `${transfer.transferNumber} → ${rule.to}`,
      firmId: input.firmId,
      branchId: transfer.fromBranchId,
      userId: input.userId,
    });

    return updated;
  });
}
