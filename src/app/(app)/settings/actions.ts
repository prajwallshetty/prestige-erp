"use server";

import { revalidatePath } from "next/cache";

import { runAction, BusinessRuleError } from "@/lib/action-result";
import { parseList, SALES_CONFIG_KEYS } from "@/lib/sales-config";
import { authorize, requireFirmId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

const ALLOWED_KEYS = new Set([
  "company_phone",
  "company_email",
  "company_website",
  "company_bank_details",
  "document_terms",
  "document_footer_text",
  "sequence_invoice_gst",
  "sequence_invoice_non_gst",
]);

export async function saveSettingsAction(input: { values: Record<string, string> }) {
  return runAction(async () => {
    const user = await authorize("settings.manage");
    const firmId = requireFirmId(user);

    const entries = Object.entries(input.values).filter(([key]) => ALLOWED_KEYS.has(key));

    for (const [key, value] of entries) {
      await prisma.setting.upsert({
        where: { firmId_key: { firmId, key } },
        create: {
          firmId,
          key,
          value,
          category: key.startsWith("sequence_") ? "documents" : key === "company_bank_details" ? "company" : "documents",
        },
        update: { value },
      });
    }

    await recordAudit({
      action: "SETTING_UPDATED",
      entity: "Setting",
      summary: `Updated ${entries.length} setting(s)`,
      firmId,
      userId: user.id,
    });

    revalidatePath("/settings");
    return { saved: entries.length };
  });
}

/**
 * Sales & marketing configuration: lead sources, campaign channels, lost
 * reasons, the "stale lead" threshold and the discount limit above which a
 * quotation needs manager approval. A blank limit means "no limit".
 */
export async function saveSalesConfigAction(input: {
  leadSources: string;
  campaignChannels: string;
  lostReasons: string;
  staleLeadDays: string;
  maxDiscountPercent: string;
}) {
  return runAction(async () => {
    const user = await authorize("settings.manage");
    const firmId = requireFirmId(user);

    const sources = parseList(input.leadSources);
    const channels = parseList(input.campaignChannels);
    const reasons = parseList(input.lostReasons);
    if (input.leadSources.trim() && sources.length === 0) throw new BusinessRuleError("Enter at least one lead source");
    if (input.campaignChannels.trim() && channels.length === 0) throw new BusinessRuleError("Enter at least one channel");
    const stale = input.staleLeadDays.trim() === "" ? null : Number(input.staleLeadDays);
    if (stale !== null && (!Number.isInteger(stale) || stale < 1 || stale > 365)) {
      throw new BusinessRuleError("The stale-lead threshold must be a whole number of days between 1 and 365");
    }
    const limit = input.maxDiscountPercent.trim() === "" ? null : Number(input.maxDiscountPercent);
    if (limit !== null && (!Number.isFinite(limit) || limit < 0 || limit > 100)) {
      throw new BusinessRuleError("The discount limit must be between 0 and 100 (leave blank for no limit)");
    }

    const values: Record<string, string> = {
      [SALES_CONFIG_KEYS.LEAD_SOURCES]: sources.join("\n"),
      [SALES_CONFIG_KEYS.CAMPAIGN_CHANNELS]: channels.join("\n"),
      [SALES_CONFIG_KEYS.LOST_REASONS]: reasons.join("\n"),
      [SALES_CONFIG_KEYS.STALE_LEAD_DAYS]: stale === null ? "" : String(stale),
      [SALES_CONFIG_KEYS.MAX_STAFF_DISCOUNT_PERCENT]: limit === null ? "" : String(limit),
    };
    for (const [key, value] of Object.entries(values)) {
      await prisma.setting.upsert({
        where: { firmId_key: { firmId, key } },
        create: { firmId, key, value, category: "sales" },
        update: { value },
      });
    }
    await recordAudit({
      action: "SETTING_UPDATED",
      entity: "Setting",
      summary: `Sales & marketing configuration updated (discount limit ${limit === null ? "none" : `${limit}%`})`,
      firmId,
      userId: user.id,
      after: { discountLimit: limit, staleLeadDays: stale },
    });
    revalidatePath("/settings");
    return { saved: true };
  });
}
