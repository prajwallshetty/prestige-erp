"use server";

import { revalidatePath } from "next/cache";

import { runAction, NotFoundError } from "@/lib/action-result";
import { authorize, requireFirmId, taxModeWhere } from "@/lib/session";
import { convertQuotationToInvoice } from "@/lib/services/sales";
import { prisma } from "@/lib/prisma";

export async function convertQuotationAction(input: {
  quotationId: string;
  customerId: string;
  paymentAmount?: number;
  paymentMethod?: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
}) {
  return runAction(async () => {
    const user = await authorize("quotation.convert");
    const firmId = requireFirmId(user);

    // View isolation: only quotations in the session's tax view can convert.
    const quotation = await prisma.quotation.findFirst({
      where: { id: input.quotationId, firmId, ...taxModeWhere(user) },
      select: { id: true, taxMode: true },
    });
    if (!quotation) throw new NotFoundError("Quotation not found");

    // The invoice inherits the quotation's own tax treatment — the report/
    // reconciliation view of the converting user never changes tax facts.
    const invoice = await convertQuotationToInvoice(firmId, input.quotationId, {
      taxMode: quotation.taxMode,
      paymentAmount: input.paymentAmount,
      paymentMethod: input.paymentMethod,
      userId: user.id,
    });

    revalidatePath("/invoices");
    revalidatePath("/quotations");
    return { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber };
  });
}
