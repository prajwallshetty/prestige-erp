"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { createSupplier } from "@/lib/services/partners";

export async function createSupplierAction(input: {
  name: string;
  phone?: string | null;
  gstin?: string | null;
  city?: string | null;
  state?: string | null;
}) {
  return runAction(async () => {
    const user = await authorize("suppliers.manage");
    const firmId = requireFirmId(user);

    const supplier = await createSupplier({
      firmId,
      name: input.name,
      phone: input.phone ?? null,
      gstin: input.gstin ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      userId: user.id,
    });

    revalidatePath("/suppliers");
    return { code: supplier.code, id: supplier.id, name: supplier.name };
  });
}
