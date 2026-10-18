"use server";

import { revalidatePath } from "next/cache";

import { runAction, NotFoundError } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch, taxModeWhere } from "@/lib/session";
import { recordCustomerPayment } from "@/lib/services/payments";
import { prisma } from "@/lib/prisma";

export async function recordPaymentAction(input: {
  customerId: string;
  amount: number;
  method: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
  invoiceId?: string | null;
}) {
  return runAction(async () => {
    const user = await authorize("payments.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    // View isolation: invoice-linked payments may only target invoices in view.
    if (input.invoiceId) {
      const invoice = await prisma.invoice.findFirst({
        where: { id: input.invoiceId, firmId, ...taxModeWhere(user) },
        select: { id: true },
      });
      if (!invoice) throw new NotFoundError("Invoice not found");
    }

    const payment = await recordCustomerPayment({
      firmId,
      branchId,
      customerId: input.customerId,
      invoiceId: input.invoiceId ?? null,
      amount: input.amount,
      method: input.method,
      userId: user.id,
    });

    revalidatePath("/payments");
    revalidatePath("/customers");
    return { paymentNumber: payment.paymentNumber };
  });
}
