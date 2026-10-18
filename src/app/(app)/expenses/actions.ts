"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { createExpense } from "@/lib/services/payments";

export async function createExpenseAction(input: {
  category: "RENT" | "ELECTRICITY" | "INTERNET" | "SALARY" | "TRANSPORT" | "OFFICE" | "MARKETING" | "MAINTENANCE" | "OTHER";
  amount: number;
  description: string;
  paidTo?: string | null;
}) {
  return runAction(async () => {
    const user = await authorize("expenses.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    const expense = await createExpense({
      firmId,
      branchId,
      category: input.category,
      amount: input.amount,
      description: input.description,
      paidTo: input.paidTo ?? null,
      paymentMethod: "CASH",
      userId: user.id,
    });

    revalidatePath("/expenses");
    return { expenseNumber: expense.expenseNumber };
  });
}
