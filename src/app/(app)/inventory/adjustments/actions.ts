"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { createStockAdjustment } from "@/lib/services/adjustments";

export async function createAdjustmentAction(input: {
  productId: string;
  type: "INCREASE" | "DECREASE" | "DAMAGE" | "LOST" | "CORRECTION";
  quantity: number;
  reason: string;
}) {
  return runAction(async () => {
    const user = await authorize("inventory.adjust");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    const adjustment = await createStockAdjustment({
      firmId,
      branchId,
      productId: input.productId,
      type: input.type,
      quantity: input.quantity,
      reason: input.reason,
      userId: user.id,
    });

    revalidatePath("/inventory/adjustments");
    revalidatePath("/inventory");
    return { adjustmentNumber: adjustment.adjustmentNumber };
  });
}
