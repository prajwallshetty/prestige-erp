import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";
import { requireFirmId, type SessionUser } from "@/lib/session";
import { getSalesConfig } from "@/lib/services/sales-config";

export interface CampaignInput {
  name: string;
  description?: string | null;
  type: string;
  channel: string;
  status?: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
  startDate?: Date | null;
  endDate?: Date | null;
  targetAudience?: string | null;
  targetLocation?: string | null;
  /** null = not recorded. Never coerced to 0. */
  budget?: number | null;
  actualSpend?: number | null;
  notes?: string | null;
  ownerId?: string | null;
  isPromotion?: boolean;
  offerValidFrom?: Date | null;
  offerValidTo?: Date | null;
  discountType?: "PERCENT" | "FLAT" | null;
  discountValue?: number | null;
  minOrderValue?: number | null;
  promoCode?: string | null;
}

const clean = (v: string | null | undefined) => v?.trim() || null;

async function validate(firmId: string, input: CampaignInput) {
  if (!input.name?.trim()) throw new BusinessRuleError("Campaign name is required");
  if (!input.type?.trim()) throw new BusinessRuleError("Campaign type is required");
  const config = await getSalesConfig(firmId);
  const channel = config.campaignChannels.find((c) => c.toLowerCase() === input.channel?.trim().toLowerCase());
  if (!channel) throw new BusinessRuleError(`"${input.channel}" is not a configured channel`);
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    throw new BusinessRuleError("The end date cannot be before the start date");
  }
  for (const [label, value] of [
    ["Budget", input.budget],
    ["Actual spend", input.actualSpend],
    ["Minimum order value", input.minOrderValue],
  ] as const) {
    if (value != null && !(value >= 0)) throw new BusinessRuleError(`${label} cannot be negative`);
  }
  if (input.ownerId) {
    const owner = await prisma.user.findFirst({ where: { id: input.ownerId, firmId, status: "ACTIVE" }, select: { id: true } });
    if (!owner) throw new BusinessRuleError("The marketing owner must be an active user of this firm");
  }
  if (input.isPromotion) {
    if (!input.discountType || !(Number(input.discountValue) > 0)) {
      throw new BusinessRuleError("A promotion needs a discount type and a discount value above zero");
    }
    if (input.discountType === "PERCENT" && Number(input.discountValue) > 100) {
      throw new BusinessRuleError("A percentage discount cannot exceed 100%");
    }
    if (input.offerValidFrom && input.offerValidTo && input.offerValidTo < input.offerValidFrom) {
      throw new BusinessRuleError("The offer end date cannot be before its start date");
    }
  }
  return channel;
}

function data(input: CampaignInput, channel: string) {
  const promo = Boolean(input.isPromotion);
  return {
    name: input.name.trim(),
    description: clean(input.description),
    type: input.type.trim(),
    channel,
    status: input.status ?? "DRAFT",
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    targetAudience: clean(input.targetAudience),
    targetLocation: clean(input.targetLocation),
    budget: input.budget ?? null,
    actualSpend: input.actualSpend ?? null,
    notes: clean(input.notes),
    ownerId: input.ownerId || null,
    isPromotion: promo,
    offerValidFrom: promo ? input.offerValidFrom ?? null : null,
    offerValidTo: promo ? input.offerValidTo ?? null : null,
    discountType: promo ? input.discountType ?? null : null,
    discountValue: promo ? input.discountValue ?? null : null,
    minOrderValue: promo ? input.minOrderValue ?? null : null,
    promoCode: promo ? clean(input.promoCode)?.toUpperCase() ?? null : null,
  };
}

export async function createCampaign(user: SessionUser, input: CampaignInput) {
  const firmId = requireFirmId(user);
  const channel = await validate(firmId, input);
  const exists = await prisma.campaign.findFirst({
    where: { firmId, name: { equals: input.name.trim(), mode: "insensitive" } },
    select: { id: true },
  });
  if (exists) throw new BusinessRuleError("A campaign with this name already exists");
  const campaign = await prisma.campaign.create({
    data: { firmId, createdById: user.id, ...data(input, channel) },
  });
  await recordAudit({
    action: "CAMPAIGN_CREATED",
    entity: "Campaign",
    entityId: campaign.id,
    summary: `${campaign.name} (${campaign.channel})`,
    firmId,
    userId: user.id,
    after: { budget: input.budget ?? null, status: campaign.status },
  });
  return campaign;
}

export async function updateCampaign(user: SessionUser, campaignId: string, input: CampaignInput) {
  const firmId = requireFirmId(user);
  const existing = await prisma.campaign.findFirst({ where: { id: campaignId, firmId } });
  if (!existing) throw new NotFoundError("Campaign not found");
  const channel = await validate(firmId, input);
  const clash = await prisma.campaign.findFirst({
    where: { firmId, id: { not: campaignId }, name: { equals: input.name.trim(), mode: "insensitive" } },
    select: { id: true },
  });
  if (clash) throw new BusinessRuleError("A campaign with this name already exists");
  const campaign = await prisma.campaign.update({ where: { id: campaignId }, data: data(input, channel) });
  await recordAudit({
    action: "CAMPAIGN_UPDATED",
    entity: "Campaign",
    entityId: campaign.id,
    summary: campaign.name,
    firmId,
    userId: user.id,
    before: {
      status: existing.status,
      budget: existing.budget && Number(existing.budget),
      actualSpend: existing.actualSpend && Number(existing.actualSpend),
    },
    after: {
      status: campaign.status,
      budget: campaign.budget && Number(campaign.budget),
      actualSpend: campaign.actualSpend && Number(campaign.actualSpend),
    },
  });
  return campaign;
}

export interface CampaignListFilters {
  q?: string;
  status?: string;
  channel?: string;
  ownerId?: string;
}

export async function listCampaigns(user: SessionUser, filters: CampaignListFilters = {}) {
  const firmId = requireFirmId(user);
  const where: Prisma.CampaignWhereInput = {
    firmId,
    ...(filters.q?.trim() ? { name: { contains: filters.q.trim(), mode: "insensitive" } } : {}),
    ...(filters.status ? { status: filters.status as never } : {}),
    ...(filters.channel ? { channel: filters.channel } : {}),
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
  };
  return prisma.campaign.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: { owner: { select: { id: true, name: true } }, _count: { select: { leads: true } } },
  });
}

export async function listMarketingOwners(firmId: string) {
  return prisma.user.findMany({
    where: { firmId, status: "ACTIVE", role: { in: ["MARKETING", "MANAGER", "ADMIN"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
