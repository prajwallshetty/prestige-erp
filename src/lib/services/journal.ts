import "server-only";

import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { round2 } from "@/lib/money";
import { DOCUMENT_TYPES, nextDocumentNumber } from "@/lib/sequence";
import { recalcCustomerRollup } from "@/lib/services/sales";
import { recalcSupplierRollup } from "@/lib/services/purchases";

export type JournalType = "DEBIT_ADJUSTMENT" | "CREDIT_ADJUSTMENT" | "DISCOUNT_ALLOWED" | "DISCOUNT_RECEIVED";

export interface JournalInput {
  firmId: string;
  type: JournalType;
  customerId?: string | null;
  supplierId?: string | null;
  amount: number;
  entryDate?: Date;
  narration: string;
  reference?: string | null;
  userId?: string | null;
}

/**
 * Records a manual adjustment / discount. It only ever *adds* a row; the
 * party's outstanding is then refreshed from the shared ledger engine.
 */
export async function createJournalEntry(input: JournalInput) {
  if (!(input.amount > 0)) throw new BusinessRuleError("Amount must be greater than zero");
  if (!input.narration.trim()) throw new BusinessRuleError("A narration is required");
  if (input.customerId && input.supplierId) {
    throw new BusinessRuleError("An entry belongs to a customer or a supplier, not both");
  }
  if (input.type === "DISCOUNT_ALLOWED" && input.supplierId) {
    throw new BusinessRuleError("Discount allowed applies to customers");
  }
  if (input.type === "DISCOUNT_RECEIVED" && input.customerId) {
    throw new BusinessRuleError("Discount received applies to suppliers");
  }

  if (input.customerId) {
    const c = await prisma.customer.findFirst({ where: { id: input.customerId, firmId: input.firmId }, select: { id: true } });
    if (!c) throw new NotFoundError("Customer not found");
  }
  if (input.supplierId) {
    const s = await prisma.supplier.findFirst({ where: { id: input.supplierId, firmId: input.firmId }, select: { id: true } });
    if (!s) throw new NotFoundError("Supplier not found");
  }

  const debitNote = input.type === "DEBIT_ADJUSTMENT" || input.type === "DISCOUNT_RECEIVED";
  const entryNumber = await nextDocumentNumber(
    input.firmId,
    debitNote ? DOCUMENT_TYPES.DEBIT_NOTE : DOCUMENT_TYPES.CREDIT_NOTE,
    "NON_GST",
  );

  return prisma.$transaction(async (tx) => {
    const entry = await tx.journalEntry.create({
      data: {
        entryNumber,
        firmId: input.firmId,
        type: input.type,
        customerId: input.customerId ?? null,
        supplierId: input.supplierId ?? null,
        amount: round2(input.amount),
        entryDate: input.entryDate ?? new Date(),
        narration: input.narration.trim(),
        reference: input.reference?.trim() || null,
        createdById: input.userId ?? null,
      },
    });
    if (input.customerId) await recalcCustomerRollup(tx as never, input.firmId, input.customerId);
    if (input.supplierId) await recalcSupplierRollup(tx as never, input.firmId, input.supplierId);
    return entry;
  });
}
