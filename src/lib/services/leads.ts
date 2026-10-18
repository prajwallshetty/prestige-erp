import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { LeadActivityType, LeadStage } from "@/generated/prisma/enums";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";
import { financialYearFor, nextDocumentSequence } from "@/lib/sequence";
import { PERMISSIONS } from "@/lib/rbac";
import { leadScopeWhere } from "@/lib/sales-scope";
import { getSalesConfig } from "@/lib/services/sales-config";
import { createCustomer } from "@/lib/services/partners";
import { LEAD_STAGES, OPEN_LEAD_STAGES, phoneKey, type LeadStageValue } from "@/lib/sales-config";
import { hasPermission, requireFirmId, type SessionUser } from "@/lib/session";

/**
 * Lead management. Every function that touches an existing lead resolves it
 * through `leadScopeWhere(user)`, so a salesperson can only ever read or change
 * leads they own, whatever id the client sends.
 *
 * `source` and `campaignId` are the lead's ORIGINAL attribution: normal edits and
 * stage changes never touch them; only `setLeadAttribution` can (audited).
 */

type Tx = Prisma.TransactionClient;

const TERMINAL: LeadStageValue[] = ["WON", "LOST"];
const isTerminal = (stage: string) => TERMINAL.includes(stage as LeadStageValue);

export interface LeadInput {
  name: string;
  phone: string;
  email?: string | null;
  location?: string | null;
  requirements?: string | null;
  productInterests?: string[];
  estimatedBudget?: number | null;
  remarks?: string | null;
  source?: string | null;
  sourceDetail?: string | null;
  campaignId?: string | null;
  assignedToId?: string | null;
}

const clean = (value: string | null | undefined) => value?.trim() || null;

function validatePhone(phone: string) {
  if (phoneKey(phone).length < 7) {
    throw new BusinessRuleError("Enter a valid phone number (at least 7 digits)");
  }
}

async function assertAssignable(firmId: string, userId: string) {
  const assignee = await prisma.user.findFirst({
    where: { id: userId, firmId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!assignee) throw new BusinessRuleError("The selected salesperson is not an active user of this firm");
}

/** Open or recent leads and existing customers sharing this phone number. */
export async function findDuplicates(firmId: string, phone: string, excludeLeadId?: string) {
  const key = phoneKey(phone);
  if (key.length < 7) return { leads: [], customers: [] };
  const [leads, customers] = await Promise.all([
    prisma.lead.findMany({
      where: { firmId, phoneKey: key, ...(excludeLeadId ? { id: { not: excludeLeadId } } : {}) },
      select: {
        id: true,
        leadNumber: true,
        name: true,
        stage: true,
        createdAt: true,
        assignedTo: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.customer.findMany({
      where: { firmId, phone: { endsWith: key } },
      select: { id: true, code: true, name: true },
      take: 3,
    }),
  ]);
  return { leads, customers };
}

async function nextLeadNumber(firmId: string, db: Tx | typeof prisma = prisma): Promise<string> {
  const fy = financialYearFor();
  const value = await nextDocumentSequence(firmId, "lead", "NON_GST", fy, db);
  return `LD-${fy}-${String(value).padStart(4, "0")}`;
}

export async function createLead(
  user: SessionUser,
  branchId: string,
  input: LeadInput,
  options: { allowDuplicate?: boolean } = {},
) {
  const firmId = requireFirmId(user);
  const name = input.name?.trim();
  if (!name) throw new BusinessRuleError("Customer name is required");
  if (!input.phone?.trim()) throw new BusinessRuleError("Phone number is required");
  validatePhone(input.phone);
  if (input.estimatedBudget != null && !(input.estimatedBudget >= 0)) {
    throw new BusinessRuleError("Estimated budget cannot be negative");
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    throw new BusinessRuleError("Enter a valid email address");
  }

  const config = await getSalesConfig(firmId);

  // Attribution: a campaign (when given) must belong to this firm; its channel
  // becomes the source unless the user picked one explicitly.
  let campaign: { id: string; channel: string } | null = null;
  if (input.campaignId) {
    campaign = await prisma.campaign.findFirst({
      where: { id: input.campaignId, firmId },
      select: { id: true, channel: true },
    });
    if (!campaign) throw new BusinessRuleError("The selected campaign does not exist");
  }
  let source = clean(input.source);
  if (source) {
    const match = config.leadSources.find((item) => item.toLowerCase() === source!.toLowerCase());
    if (!match && source.toLowerCase() !== campaign?.channel.toLowerCase()) {
      throw new BusinessRuleError(`"${source}" is not a configured lead source`);
    }
    source = match ?? source;
  } else if (campaign) {
    source = campaign.channel;
  } else {
    throw new BusinessRuleError("Select where this lead came from");
  }

  // Ownership. Without leads.assign a user can only own the lead themselves.
  const canAssign = hasPermission(user, PERMISSIONS.LEADS_ASSIGN);
  const isSalesperson = hasPermission(user, PERMISSIONS.QUOTATION_CREATE);
  let assignedToId: string | null;
  if (input.assignedToId && input.assignedToId !== user.id) {
    if (!canAssign) throw new BusinessRuleError("You can only assign leads to yourself");
    await assertAssignable(firmId, input.assignedToId);
    assignedToId = input.assignedToId;
  } else {
    assignedToId = input.assignedToId === user.id || isSalesperson ? user.id : null;
  }

  const duplicates = await findDuplicates(firmId, input.phone);
  if (duplicates.leads.length > 0 && !options.allowDuplicate) {
    const first = duplicates.leads[0];
    throw new BusinessRuleError(
      `A lead with this phone number already exists: ${first.leadNumber} (${first.name}, ${first.stage.replace("_", " ").toLowerCase()}` +
        `${first.assignedTo ? `, owned by ${first.assignedTo.name}` : ""}). Open it, or confirm to create a duplicate.`,
    );
  }

  const key = phoneKey(input.phone);
  const existingCustomerId = duplicates.customers[0]?.id ?? null;

  const lead = await prisma.$transaction(async (tx) => {
    const leadNumber = await nextLeadNumber(firmId, tx);
    const created = await tx.lead.create({
      data: {
        firmId,
        branchId,
        leadNumber,
        name,
        phone: input.phone.trim(),
        phoneKey: key,
        email: clean(input.email),
        location: clean(input.location),
        requirements: clean(input.requirements),
        productInterests: (input.productInterests ?? []).map((p) => p.trim()).filter(Boolean),
        estimatedBudget: input.estimatedBudget ?? null,
        remarks: clean(input.remarks),
        source,
        sourceDetail: clean(input.sourceDetail),
        campaignId: campaign?.id ?? null,
        assignedToId,
        createdById: user.id,
        customerId: existingCustomerId,
      },
    });
    await tx.leadActivity.create({
      data: {
        firmId,
        leadId: created.id,
        type: "CREATED",
        notes: `Lead created from ${source}${campaign ? " (campaign)" : ""}`,
        toStage: "NEW",
        createdById: user.id,
      },
    });
    return created;
  });

  await recordAudit({
    action: "LEAD_CREATED",
    entity: "Lead",
    entityId: lead.id,
    summary: `${lead.leadNumber} — ${lead.name} (${lead.source})`,
    firmId,
    branchId,
    userId: user.id,
    after: { source: lead.source, campaignId: lead.campaignId, assignedToId: lead.assignedToId },
  });

  return { lead, duplicates };
}

/** Loads a lead the user is allowed to see, or throws NotFound. */
export async function getScopedLead(user: SessionUser, leadId: string, db: Tx | typeof prisma = prisma) {
  const lead = await db.lead.findFirst({ where: { id: leadId, ...leadScopeWhere(user) } });
  if (!lead) throw new NotFoundError("Lead not found");
  return lead;
}

export type LeadUpdateInput = Omit<LeadInput, "source" | "sourceDetail" | "campaignId" | "assignedToId">;

export async function updateLead(user: SessionUser, leadId: string, input: LeadUpdateInput) {
  const lead = await getScopedLead(user, leadId);
  const name = input.name?.trim();
  if (!name) throw new BusinessRuleError("Customer name is required");
  if (!input.phone?.trim()) throw new BusinessRuleError("Phone number is required");
  validatePhone(input.phone);
  if (input.estimatedBudget != null && !(input.estimatedBudget >= 0)) {
    throw new BusinessRuleError("Estimated budget cannot be negative");
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    throw new BusinessRuleError("Enter a valid email address");
  }

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      name,
      phone: input.phone.trim(),
      phoneKey: phoneKey(input.phone),
      email: clean(input.email),
      location: clean(input.location),
      requirements: clean(input.requirements),
      productInterests: (input.productInterests ?? []).map((p) => p.trim()).filter(Boolean),
      estimatedBudget: input.estimatedBudget ?? null,
      remarks: clean(input.remarks),
    },
  });
  await recordAudit({
    action: "LEAD_UPDATED",
    entity: "Lead",
    entityId: lead.id,
    summary: `${lead.leadNumber} updated`,
    firmId: lead.firmId,
    branchId: lead.branchId,
    userId: user.id,
    before: { name: lead.name, phone: lead.phone, budget: lead.estimatedBudget && Number(lead.estimatedBudget) },
    after: { name: updated.name, phone: updated.phone, budget: updated.estimatedBudget && Number(updated.estimatedBudget) },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/** Recomputes lead.nextFollowUpAt from its open follow-ups. */
async function refreshNextFollowUp(tx: Tx, leadId: string) {
  const next = await tx.leadFollowUp.findFirst({
    where: { leadId, completedAt: null },
    orderBy: { dueAt: "asc" },
    select: { dueAt: true },
  });
  await tx.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: next?.dueAt ?? null } });
}

/**
 * Moves a lead to a new stage inside `tx`, recording the transition for funnel
 * reporting. No-op when the stage is unchanged. Closing a lead (won/lost)
 * closes its open follow-ups.
 */
export async function applyStageChange(
  tx: Tx,
  lead: { id: string; firmId: string; stage: LeadStage },
  to: LeadStage,
  options: { userId?: string | null; notes?: string | null; lostReason?: string | null } = {},
) {
  if (lead.stage === to) return false;
  const now = new Date();
  await tx.lead.update({
    where: { id: lead.id },
    data: {
      stage: to,
      lastActivityAt: now,
      lostReason: to === "LOST" ? options.lostReason ?? null : null,
      lostAt: to === "LOST" ? now : null,
      wonAt: to === "WON" ? now : null,
    },
  });
  await tx.leadActivity.create({
    data: {
      firmId: lead.firmId,
      leadId: lead.id,
      type: "STAGE_CHANGE",
      fromStage: lead.stage,
      toStage: to,
      notes: to === "LOST" ? `Lost: ${options.lostReason}${options.notes ? ` — ${options.notes}` : ""}` : options.notes ?? null,
      createdById: options.userId ?? null,
    },
  });
  if (isTerminal(to)) {
    await tx.leadFollowUp.updateMany({
      where: { leadId: lead.id, completedAt: null },
      data: { completedAt: now, completedById: options.userId ?? null, completionNotes: `Closed automatically: lead ${to.toLowerCase()}` },
    });
    await refreshNextFollowUp(tx, lead.id);
  }
  return true;
}

export async function changeLeadStage(
  user: SessionUser,
  leadId: string,
  to: string,
  options: { lostReason?: string | null; notes?: string | null } = {},
) {
  if (!(LEAD_STAGES as readonly string[]).includes(to)) throw new BusinessRuleError("Unknown lead stage");
  const lead = await getScopedLead(user, leadId);
  if (lead.stage === to) throw new BusinessRuleError("The lead is already in that stage");

  let lostReason: string | null = null;
  if (to === "LOST") {
    lostReason = options.lostReason?.trim() || null;
    if (!lostReason) throw new BusinessRuleError("Select a reason for losing this lead");
  }
  if (to === "QUOTATION_SENT") {
    const quoteCount = await prisma.quotation.count({ where: { leadId: lead.id } });
    if (quoteCount === 0) {
      throw new BusinessRuleError("Create a quotation for this lead first — the stage moves automatically when it is sent");
    }
  }

  await prisma.$transaction((tx) =>
    applyStageChange(tx, lead, to as LeadStage, { userId: user.id, notes: options.notes, lostReason }),
  );
  await recordAudit({
    action: "LEAD_STAGE_CHANGED",
    entity: "Lead",
    entityId: lead.id,
    summary: `${lead.leadNumber}: ${lead.stage} → ${to}${lostReason ? ` (${lostReason})` : ""}`,
    firmId: lead.firmId,
    branchId: lead.branchId,
    userId: user.id,
    before: { stage: lead.stage },
    after: { stage: to, lostReason },
  });
}

export async function assignLead(user: SessionUser, leadId: string, assigneeId: string | null) {
  const lead = await getScopedLead(user, leadId);
  if (assigneeId) await assertAssignable(lead.firmId, assigneeId);
  if (lead.assignedToId === assigneeId) return lead;

  const assignee = assigneeId
    ? await prisma.user.findUnique({ where: { id: assigneeId }, select: { name: true } })
    : null;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.lead.update({ where: { id: lead.id }, data: { assignedToId: assigneeId, lastActivityAt: new Date() } });
    await tx.leadActivity.create({
      data: {
        firmId: lead.firmId,
        leadId: lead.id,
        type: "ASSIGNMENT",
        notes: assignee ? `Assigned to ${assignee.name}` : "Unassigned",
        createdById: user.id,
      },
    });
    // Open follow-ups follow the new owner.
    await tx.leadFollowUp.updateMany({
      where: { leadId: lead.id, completedAt: null },
      data: { assignedToId: assigneeId },
    });
    return row;
  });
  await recordAudit({
    action: "LEAD_ASSIGNED",
    entity: "Lead",
    entityId: lead.id,
    summary: `${lead.leadNumber} → ${assignee?.name ?? "unassigned"}`,
    firmId: lead.firmId,
    branchId: lead.branchId,
    userId: user.id,
    before: { assignedToId: lead.assignedToId },
    after: { assignedToId: assigneeId },
  });
  return updated;
}

/** The only way to change a lead's original source/campaign — audited. */
export async function setLeadAttribution(
  user: SessionUser,
  leadId: string,
  input: { source?: string | null; campaignId?: string | null; reason: string },
) {
  const lead = await getScopedLead(user, leadId);
  const reason = input.reason?.trim();
  if (!reason) throw new BusinessRuleError("Give a reason for correcting the lead's attribution");
  const config = await getSalesConfig(lead.firmId);

  let campaignId = lead.campaignId;
  if (input.campaignId !== undefined) {
    if (input.campaignId) {
      const campaign = await prisma.campaign.findFirst({ where: { id: input.campaignId, firmId: lead.firmId }, select: { id: true } });
      if (!campaign) throw new BusinessRuleError("The selected campaign does not exist");
    }
    campaignId = input.campaignId || null;
  }
  let source = lead.source;
  if (input.source) {
    const match = config.leadSources.find((item) => item.toLowerCase() === input.source!.trim().toLowerCase());
    if (!match) throw new BusinessRuleError(`"${input.source}" is not a configured lead source`);
    source = match;
  }
  if (source === lead.source && campaignId === lead.campaignId) return lead;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.lead.update({ where: { id: lead.id }, data: { source, campaignId } });
    await tx.leadActivity.create({
      data: {
        firmId: lead.firmId,
        leadId: lead.id,
        type: "ATTRIBUTION",
        notes: `Attribution corrected: ${reason}`,
        createdById: user.id,
      },
    });
    return row;
  });
  await recordAudit({
    action: "LEAD_ATTRIBUTION_CHANGED",
    entity: "Lead",
    entityId: lead.id,
    summary: `${lead.leadNumber} attribution corrected: ${reason}`,
    firmId: lead.firmId,
    branchId: lead.branchId,
    userId: user.id,
    before: { source: lead.source, campaignId: lead.campaignId },
    after: { source, campaignId },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Interactions & follow-ups
// ---------------------------------------------------------------------------

export async function logActivity(
  user: SessionUser,
  leadId: string,
  input: { type: LeadActivityType; notes: string; outcome?: string | null; occurredAt?: Date | null },
) {
  const lead = await getScopedLead(user, leadId);
  const notes = input.notes?.trim();
  if (!notes) throw new BusinessRuleError("Add a note describing the interaction");
  const occurredAt = input.occurredAt ?? new Date();
  if (occurredAt.getTime() > Date.now() + 5 * 60_000) {
    throw new BusinessRuleError("An interaction cannot be dated in the future");
  }
  return prisma.$transaction(async (tx) => {
    const activity = await tx.leadActivity.create({
      data: {
        firmId: lead.firmId,
        leadId: lead.id,
        type: input.type,
        notes,
        outcome: clean(input.outcome),
        occurredAt,
        createdById: user.id,
      },
    });
    const data: Prisma.LeadUpdateInput = { lastActivityAt: occurredAt > lead.lastActivityAt ? occurredAt : lead.lastActivityAt };
    // First real contact moves a brand-new lead along.
    if (lead.stage === "NEW" && input.type !== "NOTE") {
      await applyStageChange(tx, lead, "CONTACTED", { userId: user.id, notes: "Moved after first interaction" });
    }
    await tx.lead.update({ where: { id: lead.id }, data });
    return activity;
  });
}

export async function addFollowUp(
  user: SessionUser,
  leadId: string,
  input: { dueAt: Date; notes?: string | null; quotationId?: string | null },
) {
  const lead = await getScopedLead(user, leadId);
  if (isTerminal(lead.stage)) throw new BusinessRuleError("This lead is closed — reopen it before scheduling follow-ups");
  if (Number.isNaN(input.dueAt.getTime())) throw new BusinessRuleError("Choose a valid follow-up date");
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (input.dueAt < startOfToday) throw new BusinessRuleError("The follow-up date cannot be in the past");
  if (input.quotationId) {
    const quotation = await prisma.quotation.findFirst({ where: { id: input.quotationId, leadId: lead.id }, select: { id: true } });
    if (!quotation) throw new BusinessRuleError("That quotation does not belong to this lead");
  }
  return prisma.$transaction(async (tx) => {
    const followUp = await tx.leadFollowUp.create({
      data: {
        firmId: lead.firmId,
        leadId: lead.id,
        quotationId: input.quotationId ?? null,
        dueAt: input.dueAt,
        notes: clean(input.notes),
        assignedToId: lead.assignedToId ?? user.id,
      },
    });
    await refreshNextFollowUp(tx, lead.id);
    return followUp;
  });
}

export async function completeFollowUp(
  user: SessionUser,
  followUpId: string,
  input: { notes?: string | null } = {},
) {
  const followUp = await prisma.leadFollowUp.findFirst({
    where: { id: followUpId, lead: leadScopeWhere(user) },
    include: { lead: true },
  });
  if (!followUp) throw new NotFoundError("Follow-up not found");
  if (followUp.completedAt) throw new BusinessRuleError("This follow-up is already completed");
  await prisma.$transaction(async (tx) => {
    await tx.leadFollowUp.update({
      where: { id: followUp.id },
      data: { completedAt: new Date(), completedById: user.id, completionNotes: clean(input.notes) },
    });
    await tx.leadActivity.create({
      data: {
        firmId: followUp.firmId,
        leadId: followUp.leadId,
        type: "NOTE",
        notes: `Follow-up done${input.notes?.trim() ? `: ${input.notes.trim()}` : ""}`,
        createdById: user.id,
      },
    });
    await tx.lead.update({ where: { id: followUp.leadId }, data: { lastActivityAt: new Date() } });
    await refreshNextFollowUp(tx, followUp.leadId);
  });
}

// ---------------------------------------------------------------------------
// Customer link
// ---------------------------------------------------------------------------

/**
 * Returns the customer record for a lead, creating one (or linking an existing
 * customer with the same phone) the first time a quotation is raised. Reuses
 * the customer master — no parallel customer table.
 */
export async function ensureLeadCustomer(user: SessionUser, leadId: string, branchId: string) {
  const lead = await getScopedLead(user, leadId);
  if (lead.customerId) {
    const existing = await prisma.customer.findFirst({ where: { id: lead.customerId, firmId: lead.firmId } });
    if (existing) return existing;
  }
  const match = await prisma.customer.findFirst({
    where: { firmId: lead.firmId, phone: { endsWith: lead.phoneKey } },
    orderBy: { createdAt: "asc" },
  });
  const customer =
    match ??
    (await createCustomer({
      firmId: lead.firmId,
      branchId,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      // Not `city`: the tax engine falls back to city as the place of supply
      // when a customer has no state, and a lead's free-text locality must not
      // flip a sale to inter-state (IGST). Staff set the state/city properly on
      // the customer record.
      addressLine: lead.location,
      userId: user.id,
      notes: `Created from lead ${lead.leadNumber}`,
    }));
  await prisma.lead.update({ where: { id: lead.id }, data: { customerId: customer.id } });
  return customer;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface LeadListFilters {
  q?: string;
  stage?: string;
  source?: string;
  campaignId?: string;
  /** user id, "me" or "unassigned" */
  owner?: string;
  followUp?: "overdue" | "today" | "upcoming" | "none" | "stale" | "";
  location?: string;
  from?: string;
  to?: string;
  sort?: "created" | "followup" | "activity" | "budget" | "name";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function listLeads(user: SessionUser, filters: LeadListFilters) {
  const firmId = requireFirmId(user);
  const config = await getSalesConfig(firmId);
  const and: Prisma.LeadWhereInput[] = [leadScopeWhere(user)];

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const digits = q.replace(/\D/g, "");
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { leadNumber: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { location: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    });
  }
  if (filters.stage && (LEAD_STAGES as readonly string[]).includes(filters.stage)) {
    and.push({ stage: filters.stage as LeadStage });
  }
  if (filters.source) and.push({ source: filters.source });
  if (filters.campaignId) and.push({ campaignId: filters.campaignId });
  if (filters.location?.trim()) and.push({ location: { contains: filters.location.trim(), mode: "insensitive" } });
  if (filters.owner === "me") and.push({ assignedToId: user.id });
  else if (filters.owner === "unassigned") and.push({ assignedToId: null });
  else if (filters.owner) and.push({ assignedToId: filters.owner });

  const today = startOfDay();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const open = { stage: { in: OPEN_LEAD_STAGES as LeadStage[] } };
  switch (filters.followUp) {
    case "overdue":
      and.push({ ...open, nextFollowUpAt: { lt: today } });
      break;
    case "today":
      and.push({ ...open, nextFollowUpAt: { gte: today, lt: tomorrow } });
      break;
    case "upcoming":
      and.push({ ...open, nextFollowUpAt: { gte: tomorrow } });
      break;
    case "none":
      and.push({ ...open, nextFollowUpAt: null });
      break;
    case "stale":
      and.push({ ...open, lastActivityAt: { lt: new Date(Date.now() - config.staleLeadDays * 86_400_000) } });
      break;
  }
  if (filters.from) and.push({ createdAt: { gte: new Date(filters.from) } });
  if (filters.to) and.push({ createdAt: { lt: new Date(new Date(filters.to).getTime() + 86_400_000) } });

  const where: Prisma.LeadWhereInput = { AND: and };
  const dir = filters.dir === "asc" ? "asc" : "desc";
  const orderBy: Prisma.LeadOrderByWithRelationInput[] =
    filters.sort === "followup"
      ? [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }]
      : filters.sort === "activity"
        ? [{ lastActivityAt: dir }]
        : filters.sort === "budget"
          ? [{ estimatedBudget: { sort: dir, nulls: "last" } }]
          : filters.sort === "name"
            ? [{ name: dir }]
            : [{ createdAt: dir }];

  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 5), 100);
  const page = Math.max(filters.page ?? 1, 1);

  const [total, rows] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        assignedTo: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        _count: { select: { quotations: true } },
      },
    }),
  ]);
  return { total, rows, page, pageSize, staleLeadDays: config.staleLeadDays };
}

export async function getLeadDetail(user: SessionUser, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, ...leadScopeWhere(user) },
    include: {
      assignedTo: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true, channel: true } },
      customer: { select: { id: true, name: true, code: true, phone: true, outstandingAmount: true } },
      activities: { orderBy: { occurredAt: "desc" }, take: 100, include: { createdBy: { select: { name: true } } } },
      followUps: { orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { dueAt: "asc" }], take: 50 },
      quotations: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          quotationNumber: true,
          status: true,
          reviewStatus: true,
          totalAmount: true,
          quotationDate: true,
          revision: true,
          convertedInvoices: {
            select: { id: true, invoiceNumber: true, status: true, totalAmount: true, amountPaid: true, amountDue: true },
          },
        },
      },
    },
  });
  if (!lead) throw new NotFoundError("Lead not found");
  return lead;
}

/** Active users who can own leads in this firm (for assignment pickers). */
export async function listAssignableUsers(firmId: string) {
  return prisma.user.findMany({
    where: { firmId, status: "ACTIVE", role: { in: ["SALES_STAFF", "MANAGER", "ADMIN"] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
}
