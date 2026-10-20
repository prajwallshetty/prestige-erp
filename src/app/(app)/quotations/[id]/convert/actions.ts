"use server";

import { revalidatePath } from "next/cache";

import { runAction, NotFoundError } from "@/lib/action-result";
import { authorize, AuthorizationError, hasPermission, requireFirmId } from "@/lib/session";
import { convertQuotationToInvoice } from "@/lib/services/sales";
import { quotationScopeWhere } from "@/lib/sales-scope";
import { PERMISSIONS } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

/**
 * Quotation → invoice. Manager-controlled: requires `quotation.convert`, which
 * is not part of the default Sales Staff role (it can still be granted to an
 * individual). Payment can only be taken together with the conversion when the
 * caller also holds `payments.create`.
 */
export async function convertQuotationAction(input: {
  quotationId: string;
  customerId?: string;
  paymentAmount?: number;
  paymentMethod?: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
}) {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.QUOTATION_CONVERT);
    const firmId = requireFirmId(user);

    // Record access + view isolation: only quotations visible to this user, in
    // the session's tax view, can convert.
    const quotation = await prisma.quotation.findFirst({
      where: { id: input.quotationId, ...quotationScopeWhere(user) },
      select: { id: true, taxMode: true },
    });
    if (!quotation) throw new NotFoundError("Quotation not found");

    const wantsPayment = Number(input.paymentAmount ?? 0) > 0;
    if (wantsPayment && !hasPermission(user, PERMISSIONS.PAYMENTS_CREATE)) {
      throw new AuthorizationError("You do not have permission to record payments");
    }

    // The invoice inherits the quotation's own tax treatment — the report/
    // reconciliation view of the converting user never changes tax facts.
    const invoice = await convertQuotationToInvoice(firmId, quotation.id, {
      taxMode: quotation.taxMode,
      paymentAmount: wantsPayment ? input.paymentAmount : undefined,
      paymentMethod: input.paymentMethod,
      userId: user.id,
      canApproveDiscount: hasPermission(user, PERMISSIONS.QUOTATION_APPROVE_DISCOUNT),
    });

    revalidatePath("/invoices");
    revalidatePath("/quotations");
    revalidatePath(`/quotations/${quotation.id}`);
    revalidatePath("/leads");
    revalidatePath("/marketing");
    return { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber };
  });
}
