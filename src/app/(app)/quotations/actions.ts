"use server";

import { revalidatePath } from "next/cache";

import { runAction, NotFoundError } from "@/lib/action-result";
import { authorize, AuthorizationError, hasPermission, requireFirmId, requireWriteBranch, type SessionUser } from "@/lib/session";
import {
  createQuotation,
  updateQuotation,
  deleteQuotation,
  markQuotationShared,
  submitQuotationForReview,
  reviewQuotation,
} from "@/lib/services/sales";
import { ensureLeadCustomer, getScopedLead } from "@/lib/services/leads";
import { quotationScopeWhere } from "@/lib/sales-scope";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";

interface QuotationLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  gstRate?: number;
  serialNumbers?: string[];
}

/** Server-side record access: the quotation must be visible to this user. */
async function requireScopedQuotation(user: SessionUser, quotationId: string) {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, ...quotationScopeWhere(user) },
    select: { id: true, status: true, reviewStatus: true },
  });
  if (!quotation) throw new NotFoundError("Quotation not found");
  return quotation;
}

function revalidateQuotation(id: string, leadId?: string | null) {
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

export async function createQuotationAction(input: {
  customerId: string;
  taxMode: "GST" | "NON_GST";
  leadId?: string | null;
  assignedToId?: string | null;
  validUntil?: string | null;
  notes?: string | null;
  terms?: string | null;
  discountRemarks?: string | null;
  lines: QuotationLineInput[];
  manualRoundOff?: number | null;
}) {
  return runAction(async () => {
    const user = await authorize([PERMISSIONS.QUOTATION_CREATE, PERMISSIONS.SALES_CREATE]);
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    if (!input.lines?.length) {
      throw new Error("Add at least one item to the quotation");
    }

    // A quotation for a lead always goes to the lead's customer, whatever the
    // client sent; the customer record is created/linked on first use.
    let customerId = input.customerId;
    if (input.leadId) {
      await getScopedLead(user, input.leadId);
      customerId = (await ensureLeadCustomer(user, input.leadId, branchId)).id;
    }

    // Reassigning ownership needs leads.assign; everyone else owns what they create.
    const assignedToId = hasPermission(user, PERMISSIONS.LEADS_ASSIGN) ? input.assignedToId || user.id : user.id;

    const quotation = await createQuotation({
      firmId,
      branchId,
      customerId,
      leadId: input.leadId || null,
      assignedToId,
      taxMode: input.taxMode,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      discountRemarks: input.discountRemarks?.trim() || null,
      lines: input.lines,
      userId: user.id,
      manualRoundOff: input.manualRoundOff,
      canApproveDiscount: hasPermission(user, PERMISSIONS.QUOTATION_APPROVE_DISCOUNT),
    });

    revalidateQuotation(quotation.id, input.leadId);
    return {
      quotationNumber: quotation.quotationNumber,
      id: quotation.id,
      reviewStatus: quotation.reviewStatus,
    };
  });
}

export async function updateQuotationAction(input: {
  quotationId: string;
  customerId: string;
  taxMode: "GST" | "NON_GST";
  assignedToId?: string | null;
  quotationDate?: string | null;
  validUntil?: string | null;
  notes?: string | null;
  terms?: string | null;
  discountRemarks?: string | null;
  changeNote?: string | null;
  status?: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  lines: QuotationLineInput[];
  manualRoundOff?: number | null;
}) {
  return runAction(async () => {
    const user = await authorize([
      PERMISSIONS.QUOTATION_EDIT,
      PERMISSIONS.QUOTATION_CREATE,
      PERMISSIONS.SALES_EDIT,
    ]);
    const firmId = requireFirmId(user);
    await requireScopedQuotation(user, input.quotationId);

    if (!input.lines?.length) {
      throw new Error("Add at least one item to the quotation");
    }

    const quotation = await updateQuotation({
      firmId,
      quotationId: input.quotationId,
      customerId: input.customerId,
      taxMode: input.taxMode,
      assignedToId: hasPermission(user, PERMISSIONS.LEADS_ASSIGN) ? input.assignedToId || undefined : undefined,
      quotationDate: input.quotationDate ? new Date(input.quotationDate) : undefined,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      notes: input.notes !== undefined ? input.notes?.trim() || null : undefined,
      terms: input.terms !== undefined ? input.terms?.trim() || null : undefined,
      discountRemarks: input.discountRemarks !== undefined ? input.discountRemarks?.trim() || null : undefined,
      changeNote: input.changeNote,
      status: input.status,
      lines: input.lines,
      userId: user.id,
      manualRoundOff: input.manualRoundOff,
      canApproveDiscount: hasPermission(user, PERMISSIONS.QUOTATION_APPROVE_DISCOUNT),
    });

    revalidateQuotation(quotation.id, quotation.leadId);
    return {
      quotationNumber: quotation.quotationNumber,
      id: quotation.id,
      reviewStatus: quotation.reviewStatus,
    };
  });
}

export async function deleteQuotationAction(input: { quotationId: string }) {
  return runAction(async () => {
    const user = await authorize([
      PERMISSIONS.QUOTATION_DELETE,
      PERMISSIONS.QUOTATION_EDIT,
      PERMISSIONS.SALES_EDIT,
    ]);
    const firmId = requireFirmId(user);
    await requireScopedQuotation(user, input.quotationId);

    // Salespeople may discard their own drafts; anything that has been sent or
    // reviewed is removed only by someone with review rights.
    await deleteQuotation(firmId, input.quotationId, user.id, {
      onlyDraft: !hasPermission(user, PERMISSIONS.QUOTATION_REVIEW),
    });

    revalidateQuotation(input.quotationId);
    return { success: true };
  });
}

/** Records that the quotation was handed to the customer (WhatsApp, email, PDF…). */
export async function markQuotationSharedAction(input: { quotationId: string; via: string }) {
  return runAction(async () => {
    const user = await authorize([PERMISSIONS.QUOTATION_VIEW, PERMISSIONS.SALES_VIEW]);
    const firmId = requireFirmId(user);
    await requireScopedQuotation(user, input.quotationId);
    if (!hasPermission(user, [PERMISSIONS.QUOTATION_CREATE, PERMISSIONS.QUOTATION_EDIT, PERMISSIONS.QUOTATION_REVIEW])) {
      throw new AuthorizationError();
    }
    const updated = await markQuotationShared(firmId, input.quotationId, input.via, user.id);
    revalidateQuotation(updated.id, updated.leadId);
    return { status: updated.status };
  });
}

export async function submitQuotationForReviewAction(input: { quotationId: string }) {
  return runAction(async () => {
    const user = await authorize([PERMISSIONS.QUOTATION_CREATE, PERMISSIONS.QUOTATION_EDIT]);
    const firmId = requireFirmId(user);
    await requireScopedQuotation(user, input.quotationId);
    const updated = await submitQuotationForReview(firmId, input.quotationId, user.id);
    revalidateQuotation(updated.id, updated.leadId);
    return { reviewStatus: updated.reviewStatus };
  });
}

export async function reviewQuotationAction(input: {
  quotationId: string;
  decision: "APPROVE" | "REJECT";
  notes?: string | null;
}) {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.QUOTATION_REVIEW);
    const firmId = requireFirmId(user);
    await requireScopedQuotation(user, input.quotationId);
    const updated = await reviewQuotation(firmId, input.quotationId, {
      decision: input.decision === "APPROVE" ? "APPROVE" : "REJECT",
      notes: input.notes,
      userId: user.id,
      canApproveDiscount: hasPermission(user, PERMISSIONS.QUOTATION_APPROVE_DISCOUNT),
    });
    revalidateQuotation(updated.id, updated.leadId);
    return { reviewStatus: updated.reviewStatus };
  });
}
