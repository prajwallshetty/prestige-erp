"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { firmDefaultMode } from "@/lib/access-mode";
import { createPurchaseOrder } from "@/lib/services/purchases";

export async function createPurchaseOrderAction(input: {
  supplierId: string;
  expectedDate?: string | null;
  notes?: string | null;
  lines: {
    productId: string;
    quantity: number;
    unitPrice: number;
  }[];
}) {
  return runAction(async () => {
    const user = await authorize("purchase.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    if (!input.supplierId) throw new Error("Select a supplier");
    if (!input.lines?.length) throw new Error("Add at least one item to the order");

    const order = await createPurchaseOrder({
      firmId,
      branchId,
      supplierId: input.supplierId,
      taxMode: await firmDefaultMode(firmId),
      expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
      notes: input.notes ?? null,
      lines: input.lines,
      userId: user.id,
    });

    revalidatePath("/purchases");
    return { poNumber: order.poNumber, id: order.id };
  });
}
