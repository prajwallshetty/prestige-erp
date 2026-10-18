"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { recordSupplierPayment } from "@/lib/services/payments";

export async function recordSupplierPaymentAction(input: {
  supplierId: string;
  invoiceId?: string | null;
  amount: number;
  method: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
  reference?: string | null;
}) {
  return runAction(async () => {
    const user = await authorize("payments.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    if (!input.supplierId) throw new Error("Select a supplier");
    if (input.amount <= 0) throw new Error("Amount must be greater than zero");

    const payment = await recordSupplierPayment({
      firmId,
      branchId,
      supplierId: input.supplierId,
      invoiceId: input.invoiceId ?? null,
      amount: input.amount,
      method: input.method,
      reference: input.reference ?? null,
      userId: user.id,
    });

    revalidatePath("/purchases/bills");
    revalidatePath("/payments");
    return { paymentNumber: payment.paymentNumber, id: payment.id };
  });
}
