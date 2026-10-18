"use server";

import { revalidatePath } from "next/cache";

import { runAction, NotFoundError } from "@/lib/action-result";
import { authorize, requireFirmId, taxModeWhere } from "@/lib/session";
import { approveSalesReturn } from "@/lib/services/payments";
import { prisma } from "@/lib/prisma";

export async function approveSalesReturnAction(input: { returnId: string }) {
  return runAction(async () => {
    const user = await authorize(["invoice.cancel", "sales.cancel"]);
    const firmId = requireFirmId(user);
    // View isolation: returns for out-of-view invoices cannot be approved.
    const ret = await prisma.salesReturn.findFirst({
      where: { id: input.returnId, firmId, invoice: taxModeWhere(user) },
      select: { id: true },
    });
    if (!ret) throw new NotFoundError("Return not found");
    await approveSalesReturn(firmId, input.returnId, user.id);
    revalidatePath("/sales-returns");
    revalidatePath("/inventory");
    return { approved: true };
  });
}
