"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { firmDefaultMode } from "@/lib/access-mode";
import { createPurchaseReturn } from "@/lib/services/purchases";

export async function createPurchaseReturnAction(input: {
  supplierId: string;
  purchaseInvoiceId?: string | null;
  reason?: string | null;
  lines: {
    productId: string;
    quantity: number;
    unitPrice: number;
    serialNumbers?: string[];
  }[];
}) {
  return runAction(async () => {
    const user = await authorize("purchase.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    if (!input.supplierId) throw new Error("Select a supplier");
    if (!input.lines?.length) throw new Error("Add at least one item to the return");
    if (!input.reason?.trim()) throw new Error("A return reason is required");

    const purchaseReturn = await createPurchaseReturn({
      firmId,
      branchId,
      supplierId: input.supplierId,
      purchaseInvoiceId: input.purchaseInvoiceId ?? null,
      taxMode: await firmDefaultMode(firmId),
      reason: input.reason,
      lines: input.lines,
      userId: user.id,
    });

    revalidatePath("/purchases/returns");
    revalidatePath("/inventory");
    return { returnNumber: purchaseReturn.returnNumber, id: purchaseReturn.id };
  });
}
