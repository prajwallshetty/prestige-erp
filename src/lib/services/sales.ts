import "server-only";

import { prisma } from "@/lib/prisma";
import { prisma as db } from "@/lib/prisma";
import type { TaxMode } from "@/generated/prisma/enums";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { computeTaxSummary, isSameState, sellerStateFor } from "@/lib/tax";
import { nextDocumentNumber, DOCUMENT_TYPES, financialYearFor } from "@/lib/sequence";
import { recordAudit, modeLabel } from "@/lib/audit";
import {
  assertSerialsAvailableForSale,
  getStockLevel,
  requireProduct,
  transitionSerialUnits,
  writeStockTransaction,
} from "@/lib/services/inventory";
import { round2 } from "@/lib/money";
import type { Prisma } from "@/generated/prisma/client";
import { getSalesConfig } from "@/lib/services/sales-config";
import { applyStageChange } from "@/lib/services/leads";
import { discountNeedsApproval, effectiveDiscountPercent } from "@/lib/sales-config";

/**
 * Sales service: quotations → sales orders → invoices. Invoice creation follows
 * the handover's business-rule order (validate customer → products → variants →
 * stock → serials → access mode → calculate → number → create → stock txns →
 * mark serials → payment → audit) inside one transaction.
 */

export interface SaleLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  gstRate?: number;
  serialNumbers?: string[];
  descriptionOverride?: string;
}

export interface QuotationInput {
  firmId: string;
  branchId: string;
  customerId: string;
  taxMode: TaxMode;
  quotationDate?: Date;
  validUntil?: Date | null;
  notes?: string | null;
  terms?: string | null;
  discountRemarks?: string | null;
  lines: SaleLineInput[];
  userId?: string | null;
  manualRoundOff?: number | null;
  /** Lead the quotation is raised for (must already be authorised by the caller). */
  leadId?: string | null;
  /** Owning salesperson; defaults to the creator. */
  assignedToId?: string | null;
  /** Whether the saving user may approve over-limit discounts (quotation.approve_discount). */
  canApproveDiscount?: boolean;
}

const round = round2;

type Tx = Prisma.TransactionClient;

/**
 * Review state after a content save. Over-limit discounts always need an
 * approver: a user who can approve gets it recorded as APPROVED, anyone else
 * puts the quotation in the PENDING queue (and invalidates an earlier approval,
 * because the content changed). Without an over-limit discount, a stale
 * APPROVED/REJECTED state returns to NONE and an explicit submission to
 * PENDING is kept.
 */
export function reviewStateAfterSave(
  current: "NONE" | "PENDING" | "APPROVED" | "REJECTED",
  needsApproval: boolean,
  canApprove: boolean,
): "NONE" | "PENDING" | "APPROVED" | "REJECTED" {
  if (needsApproval) return canApprove ? "APPROVED" : "PENDING";
  if (current === "APPROVED" || current === "REJECTED") return "NONE";
  return current;
}

async function writeRevision(
  tx: Tx,
  quotationId: string,
  userId: string | null | undefined,
  changeNote: string,
) {
  const full = await tx.quotation.findUniqueOrThrow({ where: { id: quotationId }, include: { lines: true } });
  await tx.quotationRevision.create({
    data: {
      quotationId,
      revision: full.revision,
      changeNote,
      // JSON round-trip turns Decimals/Dates into plain serialisable values.
      snapshot: JSON.parse(JSON.stringify(full)),
      totalAmount: full.totalAmount,
      changedById: userId ?? null,
    },
  });
}

async function assertQuotationOwner(firmId: string, userId: string) {
  const owner = await prisma.user.findFirst({ where: { id: userId, firmId, status: "ACTIVE" }, select: { id: true } });
  if (!owner) throw new BusinessRuleError("The selected salesperson is not an active user of this firm");
}

function lineDescription(
  product: { name: string; sku: string },
  variant: { name: string } | null | undefined,
): string {
  return variant ? `${product.name} — ${variant.name}` : product.name;
}

async function buildLinesWithTax(
  lines: SaleLineInput[],
  mode: TaxMode,
  sameState: boolean,
  manualRoundOff?: number | null,
) {
  if (lines.length === 0) throw new BusinessRuleError("Add at least one line item");
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { variants: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const enriched = lines.map((line) => {
    const product = productMap.get(line.productId);
    if (!product) throw new NotFoundError("Product not found");
    const variant = line.variantId
      ? product.variants.find((v) => v.id === line.variantId)
      : null;
    if (line.variantId && !variant) throw new NotFoundError("Product variant not found");
    if (line.quantity <= 0) throw new BusinessRuleError("Quantity must be greater than zero");
    if (!Number.isInteger(line.quantity)) throw new BusinessRuleError("Quantity must be a whole number");
    if (line.unitPrice < 0) throw new BusinessRuleError("Price cannot be negative");
    if ((line.discountPercent ?? 0) < 0 || (line.discountPercent ?? 0) > 100) {
      throw new BusinessRuleError("Discount must be between 0% and 100%");
    }
    if ((line.gstRate ?? 0) < 0 || (line.gstRate ?? 0) > 100) throw new BusinessRuleError("Invalid tax rate");
    return { line, product, variant };
  });

  const summary = computeTaxSummary(
    enriched.map(({ line }) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent ?? 0,
      gstRate: mode === "GST" ? (line.gstRate ?? 0) : 0,
    })),
    { mode, sameState, manualRoundOff },
  );

  return { enriched, summary };
}

// ---------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------

export async function createQuotation(input: QuotationInput) {
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { state: true, city: true },
  });
  const sellerState = await sellerStateFor(input.firmId, input.branchId);
  const supplyState = input.taxMode === "GST" ? (customer?.state ?? customer?.city ?? null) : null;
  const sameState = isSameState(sellerState, supplyState);
  const { enriched, summary } = await buildLinesWithTax(input.lines, input.taxMode, sameState, input.manualRoundOff);

  const config = await getSalesConfig(input.firmId);
  const discountPct = effectiveDiscountPercent(summary.subtotal, summary.discountAmount);
  const needsApproval = discountNeedsApproval(discountPct, config.maxStaffDiscountPercent);
  const canApprove = input.canApproveDiscount === true;

  if (input.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: input.leadId, firmId: input.firmId },
      select: { customerId: true, stage: true },
    });
    if (!lead) throw new NotFoundError("Lead not found");
    if (lead.customerId !== input.customerId) {
      throw new BusinessRuleError("The quotation customer must be the lead's customer");
    }
    if (lead.stage === "LOST") throw new BusinessRuleError("Reopen this lost lead before quoting it");
  }
  const assignedToId = input.assignedToId ?? input.userId ?? null;
  if (assignedToId && assignedToId !== input.userId) await assertQuotationOwner(input.firmId, assignedToId);

  const quotationNumber = await nextDocumentNumber(
    input.firmId,
    DOCUMENT_TYPES.QUOTATION,
    "NON_GST",
  );

  return prisma.$transaction(async (tx) => {
    const quotation = await tx.quotation.create({
      data: {
        leadId: input.leadId ?? null,
        assignedToId,
        discountPercentEffective: discountPct,
        reviewStatus: reviewStateAfterSave("NONE", needsApproval, canApprove),
        reviewedById: needsApproval && canApprove ? input.userId ?? null : null,
        reviewedAt: needsApproval && canApprove ? new Date() : null,
        quotationNumber,
        firmId: input.firmId,
        branchId: input.branchId,
        customerId: input.customerId,
        taxMode: input.taxMode,
        quotationDate: input.quotationDate ?? new Date(),
        validUntil: input.validUntil ?? null,
        subtotal: summary.subtotal,
        discountAmount: summary.discountAmount,
        taxableAmount: summary.taxableAmount,
        cgstAmount: summary.cgstAmount,
        sgstAmount: summary.sgstAmount,
        igstAmount: summary.igstAmount,
        roundOff: summary.roundOff,
        totalAmount: summary.totalAmount,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        discountRemarks: input.discountRemarks ?? null,
        createdById: input.userId ?? null,
        status: "DRAFT",
        lines: {
          create: enriched.map(({ line, product, variant }, index) => ({
            productId: product.id,
            variantId: variant?.id ?? null,
            description: line.descriptionOverride ?? lineDescription(product, variant),
            hsnCode: product.hsnCode,
            quantity: line.quantity,
            unitPrice: round(line.unitPrice),
            discountPercent: line.discountPercent ?? 0,
            gstRate: input.taxMode === "GST" ? (line.gstRate ?? 0) : 0,
            lineTotal: summary.lines[index].lineTotal,
            serialNumbers: line.serialNumbers,
          })),
        },
      },
    });

    await writeRevision(tx, quotation.id, input.userId, "Created");
    if (input.leadId) {
      await tx.leadActivity.create({
        data: {
          firmId: input.firmId,
          leadId: input.leadId,
          type: "QUOTATION",
          notes: `Quotation ${quotation.quotationNumber} created`,
          createdById: input.userId ?? null,
        },
      });
      await tx.lead.update({ where: { id: input.leadId }, data: { lastActivityAt: new Date() } });
    }

    await recordAudit({
      action: "QUOTATION_CREATED",
      entity: "Quotation",
      entityId: quotation.id,
      summary: `${quotation.quotationNumber} (${modeLabel(input.taxMode)})`,
      firmId: input.firmId,
      branchId: input.branchId,
      userId: input.userId,
      after: {
        total: Number(quotation.totalAmount),
        leadId: input.leadId ?? null,
        assignedToId,
        discountPercent: discountPct,
        reviewStatus: quotation.reviewStatus,
      },
    });

    return quotation;
  });
}

export async function updateQuotationStatus(
  firmId: string,
  quotationId: string,
  status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED",
  userId?: string | null,
) {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, firmId },
  });
  if (!quotation) throw new NotFoundError("Quotation not found");
  if (quotation.status === "CONVERTED") {
    throw new BusinessRuleError("A converted quotation cannot be changed");
  }
  return prisma.quotation.update({
    where: { id: quotationId },
    data: { status },
  });
}

// ---------------------------------------------------------------------------
// Sharing & manager review
// ---------------------------------------------------------------------------

/**
 * Records that a quotation was handed to the customer (WhatsApp / email / PDF
 * download). Moves DRAFT → SENT and advances the linked lead to "Quotation
 * sent". A quotation whose discount still needs approval cannot be sent.
 */
export async function markQuotationShared(
  firmId: string,
  quotationId: string,
  via: string,
  userId?: string | null,
) {
  const quotation = await prisma.quotation.findFirst({ where: { id: quotationId, firmId } });
  if (!quotation) throw new NotFoundError("Quotation not found");
  if (["CONVERTED", "REJECTED", "EXPIRED"].includes(quotation.status)) {
    throw new BusinessRuleError(`A ${quotation.status.toLowerCase()} quotation cannot be sent`);
  }
  const config = await getSalesConfig(firmId);
  const needsApproval = discountNeedsApproval(Number(quotation.discountPercentEffective), config.maxStaffDiscountPercent);
  if (needsApproval && quotation.reviewStatus !== "APPROVED") {
    throw new BusinessRuleError(
      `The discount (${Number(quotation.discountPercentEffective)}%) is above the ${config.maxStaffDiscountPercent}% limit — a manager must approve this quotation before it is sent`,
    );
  }
  const channel = via.trim().slice(0, 40) || "other";

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.quotation.update({
      where: { id: quotation.id },
      data: { sharedAt: new Date(), sharedVia: channel, status: quotation.status === "DRAFT" ? "SENT" : quotation.status },
    });
    if (quotation.leadId) {
      const lead = await tx.lead.findUnique({ where: { id: quotation.leadId }, select: { id: true, firmId: true, stage: true } });
      if (lead) {
        if (["NEW", "CONTACTED", "QUALIFIED"].includes(lead.stage)) {
          await applyStageChange(tx, lead, "QUOTATION_SENT", { userId, notes: `Quotation ${quotation.quotationNumber} sent` });
        }
        await tx.leadActivity.create({
          data: {
            firmId,
            leadId: lead.id,
            type: "QUOTATION",
            notes: `Quotation ${quotation.quotationNumber} shared via ${channel}`,
            createdById: userId ?? null,
          },
        });
        await tx.lead.update({ where: { id: lead.id }, data: { lastActivityAt: new Date() } });
      }
    }
    return row;
  });
  await recordAudit({
    action: "QUOTATION_SHARED",
    entity: "Quotation",
    entityId: quotation.id,
    summary: `${quotation.quotationNumber} shared via ${channel}`,
    firmId,
    branchId: quotation.branchId,
    userId,
  });
  return updated;
}

/** Salesperson asks a manager to review a quotation. */
export async function submitQuotationForReview(firmId: string, quotationId: string, userId?: string | null) {
  const quotation = await prisma.quotation.findFirst({ where: { id: quotationId, firmId } });
  if (!quotation) throw new NotFoundError("Quotation not found");
  if (["CONVERTED", "REJECTED", "EXPIRED"].includes(quotation.status)) {
    throw new BusinessRuleError(`A ${quotation.status.toLowerCase()} quotation cannot be submitted for review`);
  }
  if (quotation.reviewStatus === "PENDING") throw new BusinessRuleError("This quotation is already awaiting review");
  if (quotation.reviewStatus === "APPROVED") throw new BusinessRuleError("This quotation is already approved");
  const updated = await prisma.quotation.update({
    where: { id: quotation.id },
    data: { reviewStatus: "PENDING", reviewNotes: null, reviewedAt: null, reviewedById: null },
  });
  await recordAudit({
    action: "QUOTATION_REVIEWED",
    entity: "Quotation",
    entityId: quotation.id,
    summary: `${quotation.quotationNumber} submitted for manager review`,
    firmId,
    branchId: quotation.branchId,
    userId,
    before: { reviewStatus: quotation.reviewStatus },
    after: { reviewStatus: "PENDING" },
  });
  return updated;
}

/**
 * Manager decision on a quotation. Approving an over-limit discount needs
 * `quotation.approve_discount` (passed in as `canApproveDiscount`); rejecting
 * always needs a note so the salesperson knows what to change.
 */
export async function reviewQuotation(
  firmId: string,
  quotationId: string,
  input: { decision: "APPROVE" | "REJECT"; notes?: string | null; userId: string; canApproveDiscount: boolean },
) {
  const quotation = await prisma.quotation.findFirst({ where: { id: quotationId, firmId } });
  if (!quotation) throw new NotFoundError("Quotation not found");
  if (quotation.status === "CONVERTED") throw new BusinessRuleError("A converted quotation cannot be reviewed");
  if (quotation.reviewStatus !== "PENDING") {
    throw new BusinessRuleError("Only quotations awaiting review can be approved or sent back");
  }
  const notes = input.notes?.trim() || null;
  if (input.decision === "REJECT" && !notes) {
    throw new BusinessRuleError("Say what needs to change so the salesperson can fix it");
  }
  if (input.decision === "APPROVE") {
    const config = await getSalesConfig(firmId);
    const overLimit = discountNeedsApproval(Number(quotation.discountPercentEffective), config.maxStaffDiscountPercent);
    if (overLimit && !input.canApproveDiscount) {
      throw new BusinessRuleError("You are not permitted to approve a discount above the configured limit");
    }
  }
  const status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.quotation.update({
      where: { id: quotation.id },
      data: { reviewStatus: status, reviewedById: input.userId, reviewedAt: new Date(), reviewNotes: notes },
    });
    if (quotation.leadId) {
      await tx.leadActivity.create({
        data: {
          firmId,
          leadId: quotation.leadId,
          type: "QUOTATION",
          notes: `Quotation ${quotation.quotationNumber} ${input.decision === "APPROVE" ? "approved" : "sent back"} by manager${notes ? `: ${notes}` : ""}`,
          createdById: input.userId,
        },
      });
    }
    return row;
  });
  await recordAudit({
    action: "QUOTATION_REVIEWED",
    entity: "Quotation",
    entityId: quotation.id,
    summary: `${quotation.quotationNumber} ${status.toLowerCase()}${notes ? `: ${notes}` : ""}`,
    firmId,
    branchId: quotation.branchId,
    userId: input.userId,
    before: { reviewStatus: quotation.reviewStatus },
    after: { reviewStatus: status, discountPercent: Number(quotation.discountPercentEffective) },
  });
  return updated;
}

export interface UpdateQuotationInput {
  firmId: string;
  quotationId: string;
  customerId?: string;
  taxMode?: TaxMode;
  quotationDate?: Date;
  validUntil?: Date | null;
  notes?: string | null;
  terms?: string | null;
  discountRemarks?: string | null;
  status?: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  lines?: SaleLineInput[];
  userId?: string | null;
  manualRoundOff?: number | null;
  /** Reassign the owning salesperson (caller must hold leads.assign). */
  assignedToId?: string | null;
  canApproveDiscount?: boolean;
  /** Short note stored with the new revision. */
  changeNote?: string | null;
}

export async function updateQuotation(input: UpdateQuotationInput) {
  const quotation = await prisma.quotation.findFirst({
    where: { id: input.quotationId, firmId: input.firmId },
    include: { lines: true },
  });
  if (!quotation) throw new NotFoundError("Quotation not found");
  if (quotation.status === "CONVERTED") {
    throw new BusinessRuleError("A converted quotation cannot be edited");
  }

  const targetCustomerId = input.customerId ?? quotation.customerId;
  const targetTaxMode = input.taxMode ?? quotation.taxMode;
  const customer = await prisma.customer.findUnique({
    where: { id: targetCustomerId },
    select: { state: true, city: true },
  });
  const sellerState = await sellerStateFor(input.firmId, quotation.branchId);
  const supplyState = targetTaxMode === "GST" ? (customer?.state ?? customer?.city ?? null) : null;
  const sameState = isSameState(sellerState, supplyState);
  const linesToUse = input.lines ?? quotation.lines.map((l) => ({
    productId: l.productId,
    variantId: l.variantId,
    quantity: l.quantity,
    unitPrice: Number(l.unitPrice),
    discountPercent: Number(l.discountPercent),
    gstRate: Number(l.gstRate),
    serialNumbers: l.serialNumbers,
    descriptionOverride: l.description,
  }));

  const { enriched, summary } = await buildLinesWithTax(linesToUse, targetTaxMode, sameState, input.manualRoundOff);

  const config = await getSalesConfig(input.firmId);
  const discountPct = effectiveDiscountPercent(summary.subtotal, summary.discountAmount);
  const needsApproval = discountNeedsApproval(discountPct, config.maxStaffDiscountPercent);
  const canApprove = input.canApproveDiscount === true;
  const nextReview = reviewStateAfterSave(quotation.reviewStatus, needsApproval, canApprove);
  if (
    input.status &&
    ["SENT", "ACCEPTED"].includes(input.status) &&
    needsApproval &&
    nextReview !== "APPROVED"
  ) {
    throw new BusinessRuleError(
      `This quotation's discount (${discountPct}%) is above the ${config.maxStaffDiscountPercent}% limit — it needs manager approval before it can be sent`,
    );
  }
  if (input.assignedToId) await assertQuotationOwner(input.firmId, input.assignedToId);
  if (quotation.leadId && targetCustomerId !== quotation.customerId) {
    const lead = await prisma.lead.findFirst({ where: { id: quotation.leadId }, select: { customerId: true } });
    if (lead?.customerId !== targetCustomerId) {
      throw new BusinessRuleError("A quotation raised for a lead must stay with the lead's customer");
    }
  }

  return prisma.$transaction(async (tx) => {
    await tx.quotationLine.deleteMany({
      where: { quotationId: quotation.id },
    });

    await tx.quotation.update({
      where: { id: quotation.id },
      data: {
        revision: { increment: 1 },
        discountPercentEffective: discountPct,
        reviewStatus: nextReview,
        ...(nextReview === "APPROVED" && quotation.reviewStatus !== "APPROVED"
          ? { reviewedById: input.userId ?? null, reviewedAt: new Date() }
          : {}),
        ...(nextReview === "NONE" || nextReview === "PENDING" ? { reviewNotes: null } : {}),
        ...(input.assignedToId ? { assignedToId: input.assignedToId } : {}),
        customerId: targetCustomerId,
        taxMode: targetTaxMode,
        quotationDate: input.quotationDate ?? quotation.quotationDate,
        validUntil: input.validUntil !== undefined ? input.validUntil : quotation.validUntil,
        notes: input.notes !== undefined ? input.notes : quotation.notes,
        terms: input.terms !== undefined ? input.terms : quotation.terms,
        discountRemarks: input.discountRemarks !== undefined ? input.discountRemarks : quotation.discountRemarks,
        status: input.status ?? quotation.status,
        subtotal: summary.subtotal,
        discountAmount: summary.discountAmount,
        taxableAmount: summary.taxableAmount,
        cgstAmount: summary.cgstAmount,
        sgstAmount: summary.sgstAmount,
        igstAmount: summary.igstAmount,
        roundOff: summary.roundOff,
        totalAmount: summary.totalAmount,
      },
    });

    await tx.quotationLine.createMany({
      data: enriched.map(({ line, product, variant }, index) => ({
        quotationId: quotation.id,
        productId: product.id,
        variantId: variant?.id ?? null,
        description: line.descriptionOverride ?? lineDescription(product, variant),
        hsnCode: product.hsnCode,
        quantity: line.quantity,
        unitPrice: round(line.unitPrice),
        discountPercent: line.discountPercent ?? 0,
        gstRate: targetTaxMode === "GST" ? (line.gstRate ?? 0) : 0,
        lineTotal: summary.lines[index].lineTotal,
        serialNumbers: line.serialNumbers ?? [],
      })),
    });

    const updated = await tx.quotation.findUniqueOrThrow({
      where: { id: quotation.id },
      include: { lines: true },
    });
    await writeRevision(tx, quotation.id, input.userId, input.changeNote?.trim() || `Edited (revision ${updated.revision})`);

    await recordAudit({
      action: "QUOTATION_UPDATED",
      entity: "Quotation",
      entityId: quotation.id,
      summary: `Quotation updated: ${quotation.quotationNumber} r${updated.revision} (${modeLabel(targetTaxMode)})`,
      firmId: input.firmId,
      branchId: quotation.branchId,
      userId: input.userId,
      before: { total: Number(quotation.totalAmount), status: quotation.status, reviewStatus: quotation.reviewStatus },
      after: { total: Number(updated.totalAmount), status: updated.status, reviewStatus: updated.reviewStatus, discountPercent: discountPct },
    });

    return updated;
  });
}

export async function deleteQuotation(
  firmId: string,
  quotationId: string,
  userId?: string | null,
  options: { onlyDraft?: boolean } = {},
) {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, firmId },
    include: {
      convertedInvoices: { select: { id: true, invoiceNumber: true } },
      convertedSalesOrders: { select: { id: true, orderNumber: true } },
    },
  });
  if (!quotation) throw new NotFoundError("Quotation not found");
  if (
    quotation.status === "CONVERTED" ||
    quotation.convertedInvoices.length > 0 ||
    quotation.convertedSalesOrders.length > 0
  ) {
    throw new BusinessRuleError("Cannot delete a converted quotation");
  }
  if (options.onlyDraft && quotation.status !== "DRAFT") {
    throw new BusinessRuleError("Only draft quotations can be deleted — ask a manager to remove a sent quotation");
  }

  return prisma.$transaction(async (tx) => {
    await tx.quotationLine.deleteMany({
      where: { quotationId: quotation.id },
    });

    const deleted = await tx.quotation.delete({
      where: { id: quotation.id },
    });

    await recordAudit({
      action: "QUOTATION_DELETED",
      entity: "Quotation",
      entityId: quotation.id,
      summary: `Quotation deleted: ${quotation.quotationNumber}`,
      firmId,
      branchId: quotation.branchId,
      userId,
      before: {
        quotationNumber: quotation.quotationNumber,
        total: Number(quotation.totalAmount),
        status: quotation.status,
      },
    });

    return deleted;
  });
}

// ---------------------------------------------------------------------------
// Sales orders
// ---------------------------------------------------------------------------

export async function createSalesOrder(
  input: QuotationInput & { quotationId?: string | null },
) {
  const sameState = true; // resolved again at invoice time
  const { enriched, summary } = await buildLinesWithTax(input.lines, input.taxMode, sameState);
  const orderNumber = await nextDocumentNumber(input.firmId, DOCUMENT_TYPES.SALES_ORDER, "NON_GST");

  return prisma.$transaction(async (tx) => {
    const order = await tx.salesOrder.create({
      data: {
        orderNumber,
        firmId: input.firmId,
        branchId: input.branchId,
        customerId: input.customerId,
        quotationId: input.quotationId ?? null,
        taxMode: input.taxMode,
        status: "CONFIRMED",
        orderDate: new Date(),
        expectedDate: input.validUntil ?? null,
        subtotal: summary.subtotal,
        discountAmount: summary.discountAmount,
        discountRemarks: input.discountRemarks ?? null,
        taxableAmount: summary.taxableAmount,
        cgstAmount: summary.cgstAmount,
        sgstAmount: summary.sgstAmount,
        igstAmount: summary.igstAmount,
        totalAmount: summary.totalAmount,
        notes: input.notes ?? null,
        createdById: input.userId ?? null,
        lines: {
          create: enriched.map(({ line, product, variant }, index) => ({
            productId: product.id,
            variantId: variant?.id ?? null,
            description: line.descriptionOverride ?? lineDescription(product, variant),
            hsnCode: product.hsnCode,
            quantity: line.quantity,
            unitPrice: round(line.unitPrice),
            discountPercent: line.discountPercent ?? 0,
            gstRate: input.taxMode === "GST" ? (line.gstRate ?? 0) : 0,
            lineTotal: summary.lines[index].lineTotal,
          })),
        },
      },
    });

    await recordAudit({
      action: "SALE_CREATED",
      entity: "SalesOrder",
      entityId: order.id,
      summary: orderNumber,
      firmId: input.firmId,
      branchId: input.branchId,
      userId: input.userId,
    });

    return order;
  });
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export interface InvoiceInput {
  firmId: string;
  branchId: string;
  customerId: string;
  /** Must match the session's access mode — enforced by the caller. */
  taxMode: TaxMode;
  lines: SaleLineInput[];
  quotationId?: string | null;
  salesOrderId?: string | null;
  invoiceDate?: Date;
  dueDate?: Date | null;
  notes?: string | null;
  terms?: string | null;
  discountRemarks?: string | null;
  /** Immediate payment, if any. */
  paymentAmount?: number;
  paymentMethod?: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
  userId?: string | null;
  manualRoundOff?: number | null;
  /**
   * Runs inside the invoice transaction after the invoice and its lines exist.
   * Throwing rolls the whole invoice back (used by quotation conversion to
   * verify totals and update the lead atomically).
   */
  afterCreate?: (tx: Tx, invoice: { id: string; invoiceNumber: string; totalAmount: Prisma.Decimal; amountDue: Prisma.Decimal }) => Promise<void>;
  /** Set when the invoice is a quotation conversion by a user lacking review rights, etc. */
  conversionReview?: { reviewedById: string };
}

/**
 * Creates an invoice. In GST mode this is a Tax Invoice (CGST/SGST or IGST
 * from seller state vs place of supply); in NON_GST mode every tax field stays
 * zero and the document is a plain Non-Tax Invoice. Stock moves and serials are stamped
 * in the same transaction.
 */
export async function createInvoice(input: InvoiceInput) {
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, firmId: input.firmId },
  });
  if (!customer) throw new NotFoundError("Customer not found");
  if (Number(customer.creditLimit) > 0) {
    // Credit check against current outstanding + the total this invoice adds.
    const wouldBe = Number(customer.outstandingAmount) + (await previewInvoiceTotal(input));
    if (wouldBe > Number(customer.creditLimit)) {
      throw new BusinessRuleError(
        `Credit limit exceeded: this invoice would take the balance to ${wouldBe.toFixed(2)} against a limit of ${Number(customer.creditLimit).toFixed(2)}.`,
      );
    }
  }

  const sellerState = await sellerStateFor(input.firmId, input.branchId);
  const supplyState = input.taxMode === "GST" ? (customer.state ?? customer.city ?? null) : null;
  const sameState = isSameState(sellerState, supplyState);

  const { enriched, summary } = await buildLinesWithTax(input.lines, input.taxMode, sameState, input.manualRoundOff);

  // Serial validation before anything is written.
  for (const { line, product } of enriched) {
    if (product.trackSerials) {
      const serials = line.serialNumbers ?? [];
      if (serials.filter((s) => s.trim()).length !== line.quantity) {
        throw new BusinessRuleError(
          `${product.name} requires ${line.quantity} serial number${line.quantity === 1 ? "" : "s"}`,
        );
      }
      await assertSerialsAvailableForSale(input.firmId, product.id, input.branchId, serials);
    }
  }

  // Stock validation for non-serialized lines happens inside writeStockTransaction
  // (it refuses to drive the balance below zero) — but we pre-check so the whole
  // invoice can fail before any write.
  for (const { line, product } of enriched) {
    if (product.trackSerials) continue;
    const { getStockLevel } = await import("@/lib/services/inventory");
    const available = await getStockLevel(input.firmId, input.branchId, {
      productId: product.id,
      variantId: line.variantId ?? null,
    });
    if (available < line.quantity) {
      throw new BusinessRuleError(
        `Insufficient stock for ${product.name}: ${available} available, ${line.quantity} requested`,
      );
    }
  }

  // Quotation conversions take their number inside the transaction, after the
  // quotation claim: a request that loses a concurrent-conversion race rolls
  // back without burning an invoice number (no gaps in the legal sequence).
  let invoiceNumber: string = input.quotationId
    ? ""
    : await nextDocumentNumber(
        input.firmId,
        DOCUMENT_TYPES.INVOICE,
        input.taxMode,
        prisma,
        input.invoiceDate ?? new Date(),
      );
  const financialYear = financialYearFor(input.invoiceDate ?? new Date());

  return prisma.$transaction(async (tx) => {
    // Claim the quotation first. The conditional UPDATE takes the row lock, so
    // two simultaneous conversions serialise here and the loser matches zero
    // rows once the winner commits — no duplicate invoice can be created.
    if (input.quotationId) {
      const claim = await tx.quotation.updateMany({
        where: { id: input.quotationId, firmId: input.firmId, status: { notIn: ["CONVERTED"] } },
        data: {
          status: "CONVERTED",
          convertedAt: new Date(),
          convertedById: input.userId ?? null,
          ...(input.conversionReview
            ? { reviewStatus: "APPROVED", reviewedById: input.conversionReview.reviewedById, reviewedAt: new Date() }
            : {}),
        },
      });
      if (claim.count !== 1) {
        throw new BusinessRuleError("This quotation has already been converted to an invoice");
      }
      invoiceNumber = await nextDocumentNumber(
        input.firmId,
        DOCUMENT_TYPES.INVOICE,
        input.taxMode,
        tx,
        input.invoiceDate ?? new Date(),
      );
    }

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        kind: input.taxMode === "GST" ? "TAX_INVOICE" : "NON_GST_BILL",
        firmId: input.firmId,
        branchId: input.branchId,
        customerId: customer.id,
        taxMode: input.taxMode,
        financialYear,
        status: "ISSUED",
        billToName: customer.name,
        billToPhone: customer.phone,
        billToEmail: customer.email,
        billToAddress: [customer.addressLine, customer.city, customer.state, customer.pincode]
          .filter(Boolean)
          .join(", ") || null,
        billToGstin: customer.gstin,
        placeOfSupply: supplyState,
        quotationId: input.quotationId ?? null,
        salesOrderId: input.salesOrderId ?? null,
        invoiceDate: input.invoiceDate ?? new Date(),
        dueDate: input.dueDate ?? null,
        subtotal: summary.subtotal,
        discountAmount: summary.discountAmount,
        taxableAmount: summary.taxableAmount,
        cgstAmount: summary.cgstAmount,
        sgstAmount: summary.sgstAmount,
        igstAmount: summary.igstAmount,
        roundOff: summary.roundOff,
        totalAmount: summary.totalAmount,
        amountPaid: 0,
        amountDue: summary.totalAmount,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        discountRemarks: input.discountRemarks ?? null,
        createdById: input.userId ?? null,
        lines: {
          create: enriched.map(({ line, product, variant }, index) => ({
            productId: product.id,
            variantId: variant?.id ?? null,
            description: line.descriptionOverride ?? lineDescription(product, variant),
            hsnCode: product.hsnCode,
            serialNumbers: (line.serialNumbers ?? []).filter(Boolean).join("\n") || null,
            quantity: line.quantity,
            unitPrice: round(line.unitPrice),
            discountPercent: line.discountPercent ?? 0,
            gstRate: input.taxMode === "GST" ? (line.gstRate ?? 0) : 0,
            taxableValue: summary.lines[index].taxableValue,
            cgstAmount: summary.lines[index].cgst,
            sgstAmount: summary.lines[index].sgst,
            igstAmount: summary.lines[index].igst,
            lineTotal: summary.lines[index].lineTotal,
          })),
        },
      },
      include: { lines: true },
    });

    // Stock + serials per line.
    for (const [index, { line, product }] of enriched.entries()) {
      await writeStockTransaction(tx, {
        firmId: input.firmId,
        branchId: input.branchId,
        productId: product.id,
        variantId: line.variantId ?? null,
        type: "SALE_OUT",
        quantity: -line.quantity,
        unitCost: Number(product.purchasePrice) || null,
        reference: invoiceNumber,
        documentType: "INVOICE",
        documentId: invoice.id,
        userId: input.userId ?? null,
      });

      if (product.trackSerials) {
        const units = await tx.serialUnit.findMany({
          where: {
            firmId: input.firmId,
            serialNumber: { in: (line.serialNumbers ?? []).filter(Boolean) },
          },
          select: { id: true, sellingPrice: true },
        });
        await transitionSerialUnits(tx, {
          firmId: input.firmId,
          serialUnitIds: units.map((u) => u.id),
          eventType: "SOLD",
          toStatus: "SOLD",
          reference: invoiceNumber,
          documentId: invoice.id,
          userId: input.userId ?? null,
        });
        for (const unit of units) {
          await tx.serialUnit.update({
            where: { id: unit.id },
            data: {
              soldInvoiceId: invoice.id,
              soldInvoiceLineId: invoice.lines[index].id,
              sellingPrice: round(line.unitPrice),
              soldAt: input.invoiceDate ?? new Date(),
            },
          });
          // Warranty record per the product's warranty months.
          if (product.warrantyMonths > 0) {
            const start = input.invoiceDate ?? new Date();
            const end = new Date(start);
            end.setMonth(end.getMonth() + product.warrantyMonths);
            await tx.warranty.create({
              data: {
                firmId: input.firmId,
                productId: product.id,
                serialUnitId: unit.id,
                customerId: customer.id,
                invoiceId: invoice.id,
                branchId: input.branchId,
                serialNumber: null,
                warrantyStart: start,
                warrantyEnd: end,
                warrantyMonths: product.warrantyMonths,
                warrantyType: product.warrantyType,
                status: "ACTIVE",
              },
            });
          }
        }
      }
    }

    // Immediate payment.
    if (input.paymentAmount && input.paymentAmount > 0) {
      const paymentNumber = await nextDocumentNumber(
        input.firmId,
        DOCUMENT_TYPES.PAYMENT,
        "NON_GST",
        tx,
      );
      const amount = Math.min(input.paymentAmount, summary.totalAmount);
      await tx.payment.create({
        data: {
          paymentNumber,
          firmId: input.firmId,
          branchId: input.branchId,
          direction: "CUSTOMER_IN",
          status: "PAID",
          customerId: customer.id,
          invoiceId: invoice.id,
          amount,
          method: input.paymentMethod ?? "CASH",
          paidAt: new Date(),
          receivedById: input.userId ?? null,
        },
      });
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: amount,
          amountDue: round(summary.totalAmount - amount),
          status: amount >= summary.totalAmount ? "PAID" : "PARTIALLY_PAID",
        },
      });
    }

    if (input.salesOrderId) {
      await tx.salesOrder.update({
        where: { id: input.salesOrderId },
        data: { status: "INVOICED" },
      });
    }

    // Customer rollup.
    await recalcCustomerRollup(tx, input.firmId, customer.id);

    if (input.afterCreate) {
      const fresh = await tx.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        select: { id: true, invoiceNumber: true, totalAmount: true, amountDue: true },
      });
      await input.afterCreate(tx, fresh);
    }

    await recordAudit({
      action: "INVOICE_CREATED",
      entity: "Invoice",
      entityId: invoice.id,
      summary: `${invoiceNumber} (${input.taxMode === "GST" ? "Tax Invoice" : "Non-Tax Invoice"})`,
      firmId: input.firmId,
      branchId: input.branchId,
      userId: input.userId,
      after: {
        total: Number(invoice.totalAmount),
        tax: {
          cgst: Number(invoice.cgstAmount),
          sgst: Number(invoice.sgstAmount),
          igst: Number(invoice.igstAmount),
        },
      },
    });

    return invoice;
  });
}

async function previewInvoiceTotal(input: InvoiceInput): Promise<number> {
  const lines = input.lines.map((l) => ({
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountPercent: l.discountPercent ?? 0,
    gstRate: input.taxMode === "GST" ? (l.gstRate ?? 0) : 0,
  }));
  const summary = computeTaxSummary(lines, { mode: input.taxMode, sameState: true });
  return summary.totalAmount;
}

/**
 * Outstanding = the customer-ledger closing balance (opening + invoices +
 * refunds + debit adjustments − receipts − returns − credit adjustments).
 * The balance itself comes from the shared ledger engine so this rollup,
 * the Customer Ledger, reports and the dashboard can never disagree.
 */
export async function recalcCustomerRollup(
  tx: { customer: { findUnique: Function; update: Function } },
  firmId: string,
  customerId: string,
): Promise<void> {
  const { customerBalance } = await import("@/lib/services/ledger");
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    include: { invoices: { where: { firmId, status: { not: "CANCELLED" } }, select: { totalAmount: true } } },
  });
  if (!customer) return;

  const totalBilled = customer.invoices.reduce((sum: number, inv: { totalAmount: unknown }) => sum + Number(inv.totalAmount), 0);
  const balance = await customerBalance(tx as never, firmId, customerId);

  await tx.customer.update({
    where: { id: customerId },
    data: {
      invoiceCount: customer.invoices.length,
      totalBilled: round2(totalBilled),
      // A customer in credit (advance) shows no receivable.
      outstandingAmount: Math.max(0, balance),
      lastInvoiceAt: customer.invoices.length > 0 ? new Date() : undefined,
    },
  });
}

/** Cancellation restores stock, releases serials and reverses the rollup. */
export async function cancelInvoice(
  firmId: string,
  invoiceId: string,
  reason: string,
  userId?: string | null,
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, firmId },
    include: { lines: true, payments: true },
  });
  if (!invoice) throw new NotFoundError("Invoice not found");
  if (invoice.status === "CANCELLED") {
    throw new BusinessRuleError("This invoice is already cancelled");
  }

  return prisma.$transaction(async (tx) => {
    for (const line of invoice.lines) {
      await writeStockTransaction(tx, {
        firmId,
        branchId: invoice.branchId,
        productId: line.productId,
        variantId: line.variantId,
        type: "SALE_RETURN_IN",
        quantity: line.quantity,
        reference: invoice.invoiceNumber,
        documentType: "INVOICE_CANCEL",
        documentId: invoice.id,
        notes: "Invoice cancelled — stock restored",
        userId: userId ?? null,
      });
      if (line.serialNumbers) {
        const serials = line.serialNumbers.split("\n").filter(Boolean);
        const units = await tx.serialUnit.findMany({
          where: { firmId, serialNumber: { in: serials } },
          select: { id: true },
        });
        await transitionSerialUnits(tx, {
          firmId,
          serialUnitIds: units.map((u) => u.id),
          eventType: "SALE_RETURNED",
          toStatus: "RETURNED",
          reference: invoice.invoiceNumber,
          note: "Invoice cancelled",
          userId: userId ?? null,
        });
      }
    }

    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancellationReason: reason,
      },
    });

    await recalcCustomerRollup(tx, firmId, invoice.customerId);

    await recordAudit({
      action: "INVOICE_CANCELLED",
      entity: "Invoice",
      entityId: invoice.id,
      summary: `${invoice.invoiceNumber}: ${reason}`,
      firmId,
      branchId: invoice.branchId,
      userId,
      before: { status: invoice.status },
      after: { status: "CANCELLED" },
    });

    return updated;
  });
}

export interface UpdateInvoiceInput {
  firmId: string;
  invoiceId: string;
  userId?: string | null;
  customerId?: string;
  invoiceDate?: Date;
  dueDate?: Date | null;
  billToName?: string;
  billToPhone?: string | null;
  billToEmail?: string | null;
  billToAddress?: string | null;
  billToGstin?: string | null;
  placeOfSupply?: string | null;
  notes?: string | null;
  terms?: string | null;
  discountRemarks?: string | null;
  dispatchThrough?: string | null;
  vehicleNumber?: string | null;
  ewayBillNumber?: string | null;
  buyerOrderNo?: string | null;
  lines?: SaleLineInput[];
  manualRoundOff?: number | null;
}

export async function updateInvoice(input: UpdateInvoiceInput) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, firmId: input.firmId },
    include: { lines: true, salesReturns: true },
  });
  if (!invoice) throw new NotFoundError("Invoice not found");
  if (invoice.status === "CANCELLED") {
    throw new BusinessRuleError("A cancelled invoice cannot be edited");
  }

  const targetCustomerId = input.customerId ?? invoice.customerId;
  const customer = await prisma.customer.findFirst({
    where: { id: targetCustomerId, firmId: input.firmId },
  });
  if (!customer) throw new NotFoundError("Customer not found");

  const sellerState = await sellerStateFor(input.firmId, invoice.branchId);
  const supplyState = invoice.taxMode === "GST"
    ? (input.placeOfSupply ?? customer.state ?? customer.city ?? null)
    : null;
  const sameState = isSameState(sellerState, supplyState);

  const shouldUpdateLines = Array.isArray(input.lines) && input.lines.length > 0;

  if (shouldUpdateLines && invoice.salesReturns.length > 0) {
    throw new BusinessRuleError(
      "Line items cannot be modified because a sales return has already been processed for this invoice.",
    );
  }

  const financialYear = input.invoiceDate ? financialYearFor(input.invoiceDate) : invoice.financialYear;

  return prisma.$transaction(async (tx) => {
    let summary: any = null;
    let enrichedLines: any[] = [];

    if (shouldUpdateLines && input.lines) {
      // 1. Revert previous stock movements
      for (const line of invoice.lines) {
        await writeStockTransaction(tx, {
          firmId: input.firmId,
          branchId: invoice.branchId,
          productId: line.productId,
          variantId: line.variantId,
          type: "SALE_RETURN_IN",
          quantity: line.quantity,
          reference: invoice.invoiceNumber,
          documentType: "INVOICE_EDIT",
          documentId: invoice.id,
          notes: "Invoice edited — previous stock restored",
          userId: input.userId ?? null,
        });
      }

      // 2. Release previous serials and delete prior warranties
      await tx.serialUnit.updateMany({
        where: { soldInvoiceId: invoice.id },
        data: {
          status: "IN_STOCK",
          soldInvoiceId: null,
          soldInvoiceLineId: null,
          sellingPrice: 0,
          soldAt: null,
        },
      });

      await tx.warranty.deleteMany({
        where: { invoiceId: invoice.id },
      });

      // 3. Validate and build new lines
      const built = await buildLinesWithTax(input.lines, invoice.taxMode, sameState, input.manualRoundOff);
      enrichedLines = built.enriched;
      summary = built.summary;

      // Validate serials and stock availability
      for (const { line, product } of enrichedLines) {
        if (product.trackSerials) {
          const serials = line.serialNumbers ?? [];
          if (serials.filter((s: string) => s.trim()).length !== line.quantity) {
            throw new BusinessRuleError(
              `${product.name} requires ${line.quantity} serial number${line.quantity === 1 ? "" : "s"}`,
            );
          }
          await assertSerialsAvailableForSale(input.firmId, product.id, invoice.branchId, serials, tx);
        } else {
          const available = await getStockLevel(
            input.firmId,
            invoice.branchId,
            { productId: product.id, variantId: line.variantId ?? null },
            tx,
          );
          if (available < line.quantity) {
            throw new BusinessRuleError(
              `Insufficient stock for ${product.name}: ${available} available, ${line.quantity} requested`,
            );
          }
        }
      }

      // Delete old lines
      await tx.invoiceLine.deleteMany({
        where: { invoiceId: invoice.id },
      });
    }

    const newTotal = summary ? summary.totalAmount : Number(invoice.totalAmount);
    const amountPaid = Number(invoice.amountPaid);
    const newAmountDue = Math.max(0, round(newTotal - amountPaid));
    const newStatus = amountPaid >= newTotal ? "PAID" : amountPaid > 0 ? "PARTIALLY_PAID" : "ISSUED";

    const updateData: any = {
      customerId: targetCustomerId,
      financialYear,
      invoiceDate: input.invoiceDate ?? invoice.invoiceDate,
      dueDate: input.dueDate !== undefined ? input.dueDate : invoice.dueDate,
      billToName: input.billToName ?? invoice.billToName,
      billToPhone: input.billToPhone !== undefined ? input.billToPhone : invoice.billToPhone,
      billToEmail: input.billToEmail !== undefined ? input.billToEmail : invoice.billToEmail,
      billToAddress: input.billToAddress !== undefined ? input.billToAddress : invoice.billToAddress,
      billToGstin: input.billToGstin !== undefined ? input.billToGstin : invoice.billToGstin,
      placeOfSupply: supplyState,
      notes: input.notes !== undefined ? input.notes : invoice.notes,
      terms: input.terms !== undefined ? input.terms : invoice.terms,
      discountRemarks: input.discountRemarks !== undefined ? input.discountRemarks : invoice.discountRemarks,
      dispatchThrough: input.dispatchThrough !== undefined ? input.dispatchThrough : invoice.dispatchThrough,
      vehicleNumber: input.vehicleNumber !== undefined ? input.vehicleNumber : invoice.vehicleNumber,
      ewayBillNumber: input.ewayBillNumber !== undefined ? input.ewayBillNumber : invoice.ewayBillNumber,
      buyerOrderNo: input.buyerOrderNo !== undefined ? input.buyerOrderNo : invoice.buyerOrderNo,
    };

    if (shouldUpdateLines && summary) {
      updateData.subtotal = summary.subtotal;
      updateData.discountAmount = summary.discountAmount;
      updateData.taxableAmount = summary.taxableAmount;
      updateData.cgstAmount = summary.cgstAmount;
      updateData.sgstAmount = summary.sgstAmount;
      updateData.igstAmount = summary.igstAmount;
      updateData.roundOff = summary.roundOff;
      updateData.totalAmount = summary.totalAmount;
      updateData.amountDue = newAmountDue;
      updateData.status = newStatus;
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: updateData,
    });

    if (shouldUpdateLines && summary) {
      await tx.invoiceLine.createMany({
        data: enrichedLines.map(({ line, product, variant }, index) => ({
          invoiceId: invoice.id,
          productId: product.id,
          variantId: variant?.id ?? null,
          description: line.descriptionOverride ?? lineDescription(product, variant),
          hsnCode: product.hsnCode,
          serialNumbers: (line.serialNumbers ?? []).filter(Boolean).join("\n") || null,
          quantity: line.quantity,
          unitPrice: round(line.unitPrice),
          discountPercent: line.discountPercent ?? 0,
          gstRate: invoice.taxMode === "GST" ? (line.gstRate ?? 0) : 0,
          taxableValue: summary.lines[index].taxableValue,
          cgstAmount: summary.lines[index].cgst,
          sgstAmount: summary.lines[index].sgst,
          igstAmount: summary.lines[index].igst,
          lineTotal: summary.lines[index].lineTotal,
        })),
      });
    }

    const updated = await tx.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { lines: true },
    });

    if (shouldUpdateLines && enrichedLines.length > 0) {
      for (const [index, { line, product }] of enrichedLines.entries()) {
        await writeStockTransaction(tx, {
          firmId: input.firmId,
          branchId: invoice.branchId,
          productId: product.id,
          variantId: line.variantId ?? null,
          type: "SALE_OUT",
          quantity: -line.quantity,
          unitCost: Number(product.purchasePrice) || null,
          reference: invoice.invoiceNumber,
          documentType: "INVOICE",
          documentId: invoice.id,
          userId: input.userId ?? null,
        });

        if (product.trackSerials) {
          const units = await tx.serialUnit.findMany({
            where: {
              firmId: input.firmId,
              serialNumber: { in: (line.serialNumbers ?? []).filter(Boolean) },
            },
            select: { id: true, sellingPrice: true },
          });
          await transitionSerialUnits(tx, {
            firmId: input.firmId,
            serialUnitIds: units.map((u: { id: string }) => u.id),
            eventType: "SOLD",
            toStatus: "SOLD",
            reference: invoice.invoiceNumber,
            documentId: invoice.id,
            userId: input.userId ?? null,
          });
          for (const unit of units) {
            await tx.serialUnit.update({
              where: { id: unit.id },
              data: {
                soldInvoiceId: invoice.id,
                soldInvoiceLineId: updated.lines[index].id,
                sellingPrice: round(line.unitPrice),
                soldAt: input.invoiceDate ?? invoice.invoiceDate,
              },
            });
            if (product.warrantyMonths > 0) {
              const start = input.invoiceDate ?? invoice.invoiceDate;
              const end = new Date(start);
              end.setMonth(end.getMonth() + product.warrantyMonths);
              await tx.warranty.create({
                data: {
                  firmId: input.firmId,
                  productId: product.id,
                  serialUnitId: unit.id,
                  customerId: customer.id,
                  invoiceId: invoice.id,
                  branchId: invoice.branchId,
                  serialNumber: null,
                  warrantyStart: start,
                  warrantyEnd: end,
                  warrantyMonths: product.warrantyMonths,
                  warrantyType: product.warrantyType,
                  status: "ACTIVE",
                },
              });
            }
          }
        }
      }
    }

    if (invoice.customerId !== targetCustomerId) {
      await recalcCustomerRollup(tx, input.firmId, invoice.customerId);
      await recalcCustomerRollup(tx, input.firmId, targetCustomerId);
    } else {
      await recalcCustomerRollup(tx, input.firmId, invoice.customerId);
    }

    await recordAudit({
      action: "INVOICE_CREATED",
      entity: "Invoice",
      entityId: invoice.id,
      summary: `Invoice updated: ${invoice.invoiceNumber} (${invoice.taxMode === "GST" ? "Tax Invoice" : "Non-Tax Invoice"})`,
      firmId: input.firmId,
      branchId: invoice.branchId,
      userId: input.userId,
      after: {
        total: Number(updated.totalAmount),
      },
    });

    return updated;
  });
}

export async function deleteInvoice(
  firmId: string,
  invoiceId: string,
  userId?: string | null,
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, firmId },
    include: {
      lines: true,
      salesReturns: { select: { id: true } },
    },
  });
  if (!invoice) throw new NotFoundError("Invoice not found");
  if (invoice.salesReturns.length > 0) {
    throw new BusinessRuleError(
      "Cannot delete this invoice because sales return(s) have been processed against it.",
    );
  }

  return prisma.$transaction(async (tx) => {
    // 1. If invoice was not cancelled, restore inventory and release serials/warranties
    if (invoice.status !== "CANCELLED") {
      for (const line of invoice.lines) {
        await writeStockTransaction(tx, {
          firmId,
          branchId: invoice.branchId,
          productId: line.productId,
          variantId: line.variantId,
          type: "SALE_RETURN_IN",
          quantity: line.quantity,
          reference: invoice.invoiceNumber,
          documentType: "INVOICE_DELETE",
          documentId: invoice.id,
          notes: "Invoice deleted — stock restored",
          userId: userId ?? null,
        });

        if (line.serialNumbers) {
          const serials = line.serialNumbers.split("\n").filter(Boolean);
          const units = await tx.serialUnit.findMany({
            where: { firmId, serialNumber: { in: serials } },
            select: { id: true },
          });
          if (units.length > 0) {
            await transitionSerialUnits(tx, {
              firmId,
              serialUnitIds: units.map((u) => u.id),
              eventType: "SALE_RETURNED",
              toStatus: "IN_STOCK",
              reference: invoice.invoiceNumber,
              note: "Invoice deleted — returned to stock",
              userId: userId ?? null,
            });
          }
        }
      }

      await tx.serialUnit.updateMany({
        where: { soldInvoiceId: invoice.id },
        data: {
          status: "IN_STOCK",
          soldInvoiceId: null,
          soldInvoiceLineId: null,
          sellingPrice: 0,
          soldAt: null,
        },
      });

      await tx.warranty.deleteMany({
        where: { invoiceId: invoice.id },
      });
    }

    // 2. Delete payments associated with this invoice
    await tx.payment.deleteMany({
      where: { invoiceId: invoice.id },
    });

    // 3. Delete invoice lines
    await tx.invoiceLine.deleteMany({
      where: { invoiceId: invoice.id },
    });

    // 4. Revert quotation/order converted status if applicable
    if (invoice.quotationId) {
      const remaining = await tx.invoice.count({
        where: { quotationId: invoice.quotationId, id: { not: invoice.id } },
      });
      if (remaining === 0) {
        const reverted = await tx.quotation.update({
          where: { id: invoice.quotationId },
          data: { status: "ACCEPTED", convertedAt: null, convertedById: null },
          select: { leadId: true },
        });
        // The sale this lead was won on no longer exists — reopen the lead.
        if (reverted.leadId) {
          const lead = await tx.lead.findUnique({ where: { id: reverted.leadId }, select: { id: true, firmId: true, stage: true } });
          if (lead?.stage === "WON") {
            const otherSales = await tx.invoice.count({
              where: { quotation: { leadId: lead.id }, status: { not: "CANCELLED" }, id: { not: invoice.id } },
            });
            if (otherSales === 0) {
              await applyStageChange(tx, lead, "NEGOTIATION", {
                userId,
                notes: `Invoice ${invoice.invoiceNumber} was deleted — lead reopened`,
              });
            }
          }
        }
      }
    }
    if (invoice.salesOrderId) {
      const remaining = await tx.invoice.count({
        where: { salesOrderId: invoice.salesOrderId, id: { not: invoice.id } },
      });
      if (remaining === 0) {
        await tx.salesOrder.update({
          where: { id: invoice.salesOrderId },
          data: { status: "CONFIRMED" },
        });
      }
    }

    // 5. Delete the invoice
    const deleted = await tx.invoice.delete({
      where: { id: invoice.id },
    });

    // 6. Recalculate customer rollup
    await recalcCustomerRollup(tx, firmId, invoice.customerId);

    // 7. Record audit
    await recordAudit({
      action: "INVOICE_DELETED",
      entity: "Invoice",
      entityId: invoice.id,
      summary: `Invoice deleted: ${invoice.invoiceNumber}`,
      firmId,
      branchId: invoice.branchId,
      userId,
      before: {
        invoiceNumber: invoice.invoiceNumber,
        total: Number(invoice.totalAmount),
        status: invoice.status,
      },
    });

    return deleted;
  });
}

export async function getInvoiceForView(
  firmId: string,
  invoiceId: string,
  options: { taxMode?: TaxMode } = {},
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, firmId, ...(options.taxMode ? { taxMode: options.taxMode } : {}) },
    include: {
      customer: true,
      branch: true,
      lines: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              subName: true,
              sku: true,
              hsnCode: true,
              trackSerials: true,
              sellingPrice: true,
              gstRate: true,
            },
          },
          variant: { select: { id: true, name: true, sku: true } },
        },
      },
      payments: { orderBy: { paidAt: "asc" } },
      createdBy: { select: { name: true } },
      quotation: { select: { quotationNumber: true } },
      salesOrder: { select: { orderNumber: true } },
      salesReturns: { select: { id: true } },
    },
  });
  if (!invoice) throw new NotFoundError("Invoice not found");
  return invoice;
}

export async function getQuotationForView(
  firmId: string,
  quotationId: string,
  options: { taxMode?: TaxMode; scope?: Prisma.QuotationWhereInput } = {},
) {
  const quotation = await prisma.quotation.findFirst({
    where: {
      id: quotationId,
      firmId,
      ...(options.taxMode ? { taxMode: options.taxMode } : {}),
      // Record-level access (ownership) supplied by the caller from the session.
      ...(options.scope ? { AND: [options.scope] } : {}),
    },
    include: {
      customer: true,
      branch: true,
      lines: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              subName: true,
              sku: true,
              hsnCode: true,
              trackSerials: true,
              sellingPrice: true,
              gstRate: true,
            },
          },
          variant: { select: { id: true, name: true, sku: true } },
        },
      },
      createdBy: { select: { name: true } },
      assignedTo: { select: { id: true, name: true } },
      reviewedBy: { select: { name: true } },
      convertedBy: { select: { name: true } },
      lead: { select: { id: true, leadNumber: true, name: true, source: true, campaign: { select: { id: true, name: true } } } },
      convertedInvoices: {
        select: { id: true, invoiceNumber: true, status: true, totalAmount: true, amountPaid: true, amountDue: true, invoiceDate: true },
      },
    },
  });
  if (!quotation) throw new NotFoundError("Quotation not found");
  return quotation;
}

export async function getSalesOrderForView(
  firmId: string,
  orderId: string,
  options: { taxMode?: TaxMode } = {},
) {
  const order = await prisma.salesOrder.findFirst({
    where: { id: orderId, firmId, ...(options.taxMode ? { taxMode: options.taxMode } : {}) },
    include: {
      customer: true,
      branch: true,
      lines: {
        include: {
          product: { select: { name: true, subName: true, sku: true, hsnCode: true } },
          variant: { select: { name: true, sku: true } },
        },
      },
      createdBy: { select: { name: true } },
      quotation: { select: { quotationNumber: true } },
    },
  });
  if (!order) throw new NotFoundError("Sales order not found");
  return order;
}

/**
 * Manager-controlled quote → invoice conversion.
 *
 * The caller (server action) has already checked `quotation.convert`. This
 * function validates that the quotation is eligible, builds the invoice from the
 * quotation's own lines, and — in ONE transaction — claims the quotation
 * (so concurrent requests cannot both succeed), creates the invoice, verifies
 * the totals still match, marks the linked lead as won and writes the audit
 * trail. The original quotation and its revision history are never modified
 * beyond status/conversion stamps.
 */
export async function convertQuotationToInvoice(
  firmId: string,
  quotationId: string,
  options: {
    taxMode: TaxMode;
    paymentAmount?: number;
    paymentMethod?: InvoiceInput["paymentMethod"];
    userId?: string | null;
    /** The converting user holds quotation.approve_discount. */
    canApproveDiscount?: boolean;
  },
) {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, firmId },
    include: { lines: true, customer: true },
  });
  if (!quotation) throw new NotFoundError("Quotation not found");

  // --- Eligibility -----------------------------------------------------------
  if (quotation.status === "CONVERTED") {
    throw new BusinessRuleError("This quotation has already been converted to an invoice");
  }
  if (quotation.status === "REJECTED" || quotation.status === "EXPIRED") {
    throw new BusinessRuleError(`A ${quotation.status.toLowerCase()} quotation cannot be converted`);
  }
  if (quotation.validUntil && quotation.validUntil < new Date(new Date().setHours(0, 0, 0, 0))) {
    throw new BusinessRuleError("This quotation has passed its validity date — extend the validity before converting");
  }
  if (quotation.reviewStatus === "REJECTED") {
    throw new BusinessRuleError("This quotation was sent back for changes and has not been resubmitted");
  }
  if (quotation.lines.length === 0) throw new BusinessRuleError("The quotation has no items");
  if (!quotation.customer.isActive) throw new BusinessRuleError("The customer is inactive");
  if (!quotation.customer.name.trim() || !quotation.customer.phone.trim()) {
    throw new BusinessRuleError("The customer's name and phone are required before invoicing");
  }

  const config = await getSalesConfig(firmId);
  const overLimit = discountNeedsApproval(Number(quotation.discountPercentEffective), config.maxStaffDiscountPercent);
  if (overLimit && quotation.reviewStatus !== "APPROVED" && !options.canApproveDiscount) {
    throw new BusinessRuleError(
      `The discount (${Number(quotation.discountPercentEffective)}%) is above the ${config.maxStaffDiscountPercent}% limit and has not been approved`,
    );
  }

  // Pricing sanity before anything is written.
  const products = await prisma.product.findMany({
    where: { id: { in: quotation.lines.map((l) => l.productId) } },
    select: { id: true, status: true, name: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  for (const line of quotation.lines) {
    const product = productById.get(line.productId);
    if (!product) throw new BusinessRuleError("A product on this quotation no longer exists");
    if (product.status !== "ACTIVE") throw new BusinessRuleError(`${product.name} is inactive and cannot be invoiced`);
    if (line.quantity <= 0) throw new BusinessRuleError(`Invalid quantity on ${line.description}`);
    if (Number(line.unitPrice) < 0) throw new BusinessRuleError(`Invalid rate on ${line.description}`);
    if (Number(line.discountPercent) < 0 || Number(line.discountPercent) > 100) {
      throw new BusinessRuleError(`Invalid discount on ${line.description}`);
    }
  }

  const quotedTotal = Number(quotation.totalAmount);
  const lead = quotation.leadId
    ? await prisma.lead.findUnique({ where: { id: quotation.leadId }, select: { id: true, firmId: true, stage: true } })
    : null;

  const invoice = await createInvoice({
    firmId,
    branchId: quotation.branchId,
    customerId: quotation.customerId,
    taxMode: options.taxMode,
    quotationId: quotation.id,
    notes: quotation.notes,
    terms: quotation.terms,
    discountRemarks: quotation.discountRemarks,
    manualRoundOff: quotation.roundOff != null ? Number(quotation.roundOff) : undefined,
    paymentAmount: options.paymentAmount,
    paymentMethod: options.paymentMethod,
    userId: options.userId,
    conversionReview:
      quotation.reviewStatus !== "APPROVED" && options.userId ? { reviewedById: options.userId } : undefined,
    lines: quotation.lines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
      unitPrice: Number(line.unitPrice),
      discountPercent: Number(line.discountPercent),
      gstRate: Number(line.gstRate),
      serialNumbers: line.serialNumbers,
      // Keep the exact wording the customer saw on the quotation.
      descriptionOverride: line.description,
    })),
    afterCreate: async (tx, created) => {
      // Totals must reproduce exactly what the customer was quoted.
      if (Math.abs(Number(created.totalAmount) - quotedTotal) > 0.01) {
        throw new BusinessRuleError(
          `The invoice total (${Number(created.totalAmount).toFixed(2)}) differs from the quotation (${quotedTotal.toFixed(2)}). ` +
            "Prices or taxes changed since the quotation was made — revise the quotation first.",
        );
      }
      if (lead && lead.stage !== "WON") {
        await applyStageChange(tx, lead, "WON", {
          userId: options.userId,
          notes: `Won — invoice ${created.invoiceNumber} raised from ${quotation.quotationNumber}`,
        });
      }
      await tx.auditLog.create({
        data: {
          action: "QUOTATION_CONVERTED",
          entity: "Quotation",
          entityId: quotation.id,
          summary: `${quotation.quotationNumber} (r${quotation.revision}) → ${created.invoiceNumber}`,
          firmId,
          branchId: quotation.branchId,
          userId: options.userId ?? null,
          before: { status: quotation.status, reviewStatus: quotation.reviewStatus, total: quotedTotal },
          after: { status: "CONVERTED", invoiceId: created.id, invoiceNumber: created.invoiceNumber, total: Number(created.totalAmount) },
        },
      });
    },
  });

  return invoice;
}

export { db };
