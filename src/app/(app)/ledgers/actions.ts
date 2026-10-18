"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { createJournalEntry, type JournalType } from "@/lib/services/journal";

export async function createJournalEntryAction(input: {
  type: JournalType;
  customerId?: string | null;
  supplierId?: string | null;
  amount: number;
  entryDate?: string | null;
  narration: string;
  reference?: string | null;
}) {
  return runAction(async () => {
    const user = await authorize("payments.create");
    const firmId = requireFirmId(user);
    const entry = await createJournalEntry({
      firmId,
      type: input.type,
      customerId: input.customerId || null,
      supplierId: input.supplierId || null,
      amount: input.amount,
      entryDate: input.entryDate ? new Date(input.entryDate) : undefined,
      narration: input.narration,
      reference: input.reference ?? null,
      userId: user.id,
    });
    revalidatePath("/ledgers", "layout");
    revalidatePath("/customers");
    revalidatePath("/suppliers");
    revalidatePath("/dashboard");
    return { entryNumber: entry.entryNumber };
  });
}
