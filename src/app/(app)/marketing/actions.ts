"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAction } from "@/lib/action-result";
import { authorize } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { createCampaign, updateCampaign } from "@/lib/services/campaigns";

const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const money = z.number().min(0).max(1e10).nullish().transform((v) => v ?? null);
const date = z
  .string()
  .nullish()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date" });
      return z.NEVER;
    }
    return d;
  });

const campaignSchema = z.object({
  name: z.string().trim().min(1, "Campaign name is required").max(120),
  description: text(2000),
  type: z.string().trim().min(1, "Campaign type is required").max(60),
  channel: z.string().trim().min(1, "Choose a channel").max(60),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]).default("DRAFT"),
  startDate: date,
  endDate: date,
  targetAudience: text(500),
  targetLocation: text(200),
  budget: money,
  actualSpend: money,
  notes: text(4000),
  ownerId: text(60),
  isPromotion: z.boolean().default(false),
  offerValidFrom: date,
  offerValidTo: date,
  discountType: z.enum(["PERCENT", "FLAT"]).nullish().transform((v) => v ?? null),
  discountValue: money,
  minOrderValue: money,
  promoCode: text(30),
});

export type CampaignFormInput = z.input<typeof campaignSchema>;

function refresh(id?: string) {
  revalidatePath("/marketing");
  revalidatePath("/marketing/campaigns");
  if (id) revalidatePath(`/marketing/campaigns/${id}`);
}

export async function createCampaignAction(raw: CampaignFormInput) {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.MARKETING_MANAGE);
    const campaign = await createCampaign(user, campaignSchema.parse(raw));
    refresh(campaign.id);
    return { id: campaign.id };
  });
}

export async function updateCampaignAction(raw: CampaignFormInput & { campaignId: string }) {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.MARKETING_MANAGE);
    const { campaignId, ...rest } = raw;
    const campaign = await updateCampaign(user, campaignId, campaignSchema.parse(rest));
    refresh(campaign.id);
    return { id: campaign.id };
  });
}
