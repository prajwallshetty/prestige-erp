"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { claimWarranty } from "@/lib/services/products";

export async function claimWarrantyAction(input: { warrantyId: string; note?: string }) {
  return runAction(async () => {
    const user = await authorize("warranty.claim");
    const firmId = requireFirmId(user);
    await claimWarranty(firmId, input.warrantyId, input.note, user.id);
    revalidatePath("/warranty");
    return { claimed: true };
  });
}
