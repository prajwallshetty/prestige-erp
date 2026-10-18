"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAction, BusinessRuleError } from "@/lib/action-result";
import { authorize, hasPermission, requireFirmId, requireWriteBranch } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import {
  addFollowUp,
  assignLead,
  changeLeadStage,
  completeFollowUp,
  createLead,
  ensureLeadCustomer,
  findDuplicates,
  getScopedLead,
  logActivity,
  setLeadAttribution,
  updateLead,
} from "@/lib/services/leads";
import { LOGGABLE_ACTIVITY_TYPES } from "@/lib/sales-config";

const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => v || null);

const leadFields = {
  name: z.string().trim().min(1, "Customer name is required").max(120),
  phone: z.string().trim().min(1, "Phone number is required").max(30),
  email: optionalText(120),
  location: optionalText(120),
  requirements: optionalText(2000),
  productInterests: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  estimatedBudget: z.number().min(0).max(1e10).nullish().transform((v) => v ?? null),
  remarks: optionalText(2000),
};

const createSchema = z.object({
  ...leadFields,
  source: optionalText(80),
  sourceDetail: optionalText(120),
  campaignId: optionalText(60),
  assignedToId: optionalText(60),
  allowDuplicate: z.boolean().optional(),
});

function revalidateLeads(leadId?: string) {
  revalidatePath("/leads");
  revalidatePath("/marketing");
  revalidatePath("/dashboard");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

export async function checkLeadDuplicatesAction(input: { phone: string; excludeLeadId?: string }) {
  return runAction(async () => {
    const user = await authorize([PERMISSIONS.LEADS_CREATE, PERMISSIONS.LEADS_EDIT]);
    const firmId = requireFirmId(user);
    const { leads, customers } = await findDuplicates(firmId, input.phone, input.excludeLeadId);
    // Expose only what a warning needs; ownership stays visible so people can coordinate.
    return {
      leads: leads.map((l) => ({
        id: l.id,
        leadNumber: l.leadNumber,
        name: l.name,
        stage: l.stage,
        owner: l.assignedTo?.name ?? null,
        // Only link to leads the user can actually open.
        canOpen: hasPermission(user, PERMISSIONS.LEADS_VIEW_ALL),
      })),
      customers: customers.map((c) => ({ id: c.id, name: c.name, code: c.code })),
    };
  });
}

export async function createLeadAction(raw: z.input<typeof createSchema>) {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.LEADS_CREATE);
    const input = createSchema.parse(raw);
    const branchId = await requireWriteBranch(user, null);
    const { lead, duplicates } = await createLead(user, branchId, input, { allowDuplicate: input.allowDuplicate });
    revalidateLeads(lead.id);
    return {
      id: lead.id,
      leadNumber: lead.leadNumber,
      linkedCustomer: duplicates.customers[0]?.name ?? null,
    };
  });
}

const updateSchema = z.object({ leadId: z.string().min(1), ...leadFields });

export async function updateLeadAction(raw: z.input<typeof updateSchema>) {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.LEADS_EDIT);
    const { leadId, ...input } = updateSchema.parse(raw);
    await updateLead(user, leadId, input);
    revalidateLeads(leadId);
    return { id: leadId };
  });
}

export async function changeLeadStageAction(input: {
  leadId: string;
  stage: string;
  lostReason?: string | null;
  notes?: string | null;
}) {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.LEADS_EDIT);
    await changeLeadStage(user, input.leadId, input.stage, { lostReason: input.lostReason, notes: input.notes });
    revalidateLeads(input.leadId);
    return { id: input.leadId };
  });
}

export async function assignLeadAction(input: { leadId: string; assigneeId: string | null }) {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.LEADS_ASSIGN);
    await assignLead(user, input.leadId, input.assigneeId || null);
    revalidateLeads(input.leadId);
    return { id: input.leadId };
  });
}

const activitySchema = z.object({
  leadId: z.string().min(1),
  type: z.enum(LOGGABLE_ACTIVITY_TYPES),
  notes: z.string().trim().min(1, "Add a note describing the interaction").max(4000),
  outcome: optionalText(200),
  occurredAt: z.string().nullish(),
});

export async function logActivityAction(raw: z.input<typeof activitySchema>) {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.LEADS_EDIT);
    const input = activitySchema.parse(raw);
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : null;
    if (occurredAt && Number.isNaN(occurredAt.getTime())) throw new BusinessRuleError("Enter a valid date");
    await logActivity(user, input.leadId, { type: input.type, notes: input.notes, outcome: input.outcome, occurredAt });
    revalidateLeads(input.leadId);
    return { id: input.leadId };
  });
}

export async function addFollowUpAction(input: { leadId: string; dueAt: string; notes?: string | null; quotationId?: string | null }) {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.LEADS_EDIT);
    const dueAt = new Date(input.dueAt);
    if (Number.isNaN(dueAt.getTime())) throw new BusinessRuleError("Choose a valid follow-up date");
    await addFollowUp(user, input.leadId, { dueAt, notes: input.notes, quotationId: input.quotationId });
    revalidateLeads(input.leadId);
    return { id: input.leadId };
  });
}

export async function completeFollowUpAction(input: { followUpId: string; leadId: string; notes?: string | null }) {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.LEADS_EDIT);
    await completeFollowUp(user, input.followUpId, { notes: input.notes });
    revalidateLeads(input.leadId);
    return { id: input.leadId };
  });
}

/** Source/campaign are original attribution; correcting them is restricted and audited. */
export async function setLeadAttributionAction(input: {
  leadId: string;
  source?: string | null;
  campaignId?: string | null;
  reason: string;
}) {
  return runAction(async () => {
    const user = await authorize([PERMISSIONS.MARKETING_MANAGE, PERMISSIONS.LEADS_ASSIGN]);
    await setLeadAttribution(user, input.leadId, input);
    revalidateLeads(input.leadId);
    return { id: input.leadId };
  });
}

/** Ensures the lead has a customer record and returns it, ready for a quotation. */
export async function prepareLeadQuotationAction(input: { leadId: string }) {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.QUOTATION_CREATE);
    const branchId = await requireWriteBranch(user, null);
    await getScopedLead(user, input.leadId);
    if (!hasPermission(user, PERMISSIONS.CUSTOMERS_CREATE)) {
      const lead = await getScopedLead(user, input.leadId);
      if (!lead.customerId) throw new BusinessRuleError("You do not have permission to create the customer record for this lead");
    }
    const customer = await ensureLeadCustomer(user, input.leadId, branchId);
    revalidateLeads(input.leadId);
    return { customerId: customer.id };
  });
}
