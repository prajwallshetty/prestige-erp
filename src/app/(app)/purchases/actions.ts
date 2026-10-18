"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { receiveGoods } from "@/lib/services/purchases";
import { firmDefaultMode } from "@/lib/access-mode";

export async function receiveGoodsAction(input: {
  supplierId: string;
  /** When receiving against a purchase order, its id — drives PO progress. */
  poId?: string | null;
  supplierRef?: string | null;
  paymentAmount?: number;
  lines: {
    productId: string;
    quantity: number;
    unitPrice: number;
    serialNumbers?: string[];
  }[];
}) {
  return runAction(async () => {
    const user = await authorize("purchase.receive");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    const result = await receiveGoods({
      firmId,
      branchId,
      supplierId: input.supplierId,
      poId: input.poId ?? null,
      supplierRef: input.supplierRef ?? null,
      taxMode: await firmDefaultMode(firmId),
      paymentAmount: input.paymentAmount,
      lines: input.lines.map((line) => ({ ...line, gstRate: 18 })),
      userId: user.id,
    });

    revalidatePath("/purchases");
    revalidatePath("/inventory");
    return { invoiceNumber: result.purchaseInvoice.invoiceNumber };
  });
}
