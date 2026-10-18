"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { createStockTransfer, advanceStockTransfer } from "@/lib/services/adjustments";

export async function createTransferAction(input: {
  fromBranchId: string;
  toBranchId: string;
  lines: { productId: string; quantity: number; serialNumbers?: string[] }[];
}) {
  return runAction(async () => {
    const user = await authorize("inventory.transfer");
    const firmId = requireFirmId(user);

    const transfer = await createStockTransfer({
      firmId,
      fromBranchId: input.fromBranchId,
      toBranchId: input.toBranchId,
      lines: input.lines,
      userId: user.id,
    });

    revalidatePath("/inventory/transfers");
    return { transferNumber: transfer.transferNumber };
  });
}

export async function advanceTransferAction(input: {
  transferId: string;
  action: "request" | "approve" | "dispatch" | "receive" | "cancel";
}) {
  return runAction(async () => {
    const user = await authorize("inventory.transfer");
    const firmId = requireFirmId(user);

    const transfer = await advanceStockTransfer({
      firmId,
      transferId: input.transferId,
      action: input.action,
      userId: user.id,
    });

    revalidatePath("/inventory/transfers");
    revalidatePath("/inventory");
    return { status: transfer.status as string };
  });
}
