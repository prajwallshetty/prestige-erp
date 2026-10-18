/**
 * Pure (client-safe) sales & marketing configuration: defaults, parsing and the
 * helpers shared by the lead, quotation and marketing modules. Firm-specific
 * values live in the `settings` table; see services/sales-config.ts.
 */

export const SALES_CONFIG_KEYS = {
  LEAD_SOURCES: "lead_sources",
  CAMPAIGN_CHANNELS: "campaign_channels",
  LOST_REASONS: "lead_lost_reasons",
  STALE_LEAD_DAYS: "lead_stale_days",
  MAX_STAFF_DISCOUNT_PERCENT: "quotation_max_discount_percent",
} as const;

export const DEFAULT_LEAD_SOURCES = [
  "Showroom Walk-in",
  "Phone Call",
  "Website Enquiry",
  "Referral",
  "Marketing Campaign",
  "Google Ads",
  "Instagram",
  "Facebook",
  "Event",
  "Other",
];

export const DEFAULT_CAMPAIGN_CHANNELS = [
  "Google Ads",
  "Instagram",
  "Facebook",
  "Website Enquiry",
  "Referral",
  "Showroom Promotion",
  "Event",
  "Other",
];

export const DEFAULT_LOST_REASONS = [
  "Price too high",
  "Chose a competitor",
  "Postponed / not ready",
  "Not responding",
  "Requirement changed",
  "Out of stock / unavailable",
  "Other",
];

export const DEFAULT_STALE_LEAD_DAYS = 7;

/** Comma- or newline-separated list → trimmed, de-duplicated (case-insensitive) items. */
export function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const item = part.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Positive number or null ("not configured"). A blank value means no limit. */
export function parseOptionalPercent(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

export interface SalesConfig {
  leadSources: string[];
  campaignChannels: string[];
  lostReasons: string[];
  staleLeadDays: number;
  /** Discount % above which a quotation needs `quotation.approve_discount`. null = no limit configured. */
  maxStaffDiscountPercent: number | null;
}

export function buildSalesConfig(settings: Map<string, string>): SalesConfig {
  const sources = parseList(settings.get(SALES_CONFIG_KEYS.LEAD_SOURCES));
  const channels = parseList(settings.get(SALES_CONFIG_KEYS.CAMPAIGN_CHANNELS));
  const reasons = parseList(settings.get(SALES_CONFIG_KEYS.LOST_REASONS));
  const stale = Number(settings.get(SALES_CONFIG_KEYS.STALE_LEAD_DAYS));
  return {
    leadSources: sources.length ? sources : DEFAULT_LEAD_SOURCES,
    campaignChannels: channels.length ? channels : DEFAULT_CAMPAIGN_CHANNELS,
    lostReasons: reasons.length ? reasons : DEFAULT_LOST_REASONS,
    staleLeadDays: Number.isFinite(stale) && stale >= 1 ? Math.floor(stale) : DEFAULT_STALE_LEAD_DAYS,
    maxStaffDiscountPercent: parseOptionalPercent(settings.get(SALES_CONFIG_KEYS.MAX_STAFF_DISCOUNT_PERCENT)),
  };
}

// ---------------------------------------------------------------------------
// Lead pipeline
// ---------------------------------------------------------------------------

export const LEAD_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "QUOTATION_SENT", "NEGOTIATION", "WON", "LOST"] as const;
export type LeadStageValue = (typeof LEAD_STAGES)[number];

/** Open stages in funnel order (WON/LOST are outcomes). */
export const OPEN_LEAD_STAGES: LeadStageValue[] = ["NEW", "CONTACTED", "QUALIFIED", "QUOTATION_SENT", "NEGOTIATION"];

export const LEAD_STAGE_LABELS: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  QUOTATION_SENT: "Quotation sent",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
};

export const LEAD_ACTIVITY_LABELS: Record<string, string> = {
  CREATED: "Lead created",
  CALL: "Call",
  MEETING: "Meeting",
  VISIT: "Showroom visit",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  NOTE: "Note",
  STAGE_CHANGE: "Stage change",
  ASSIGNMENT: "Assignment",
  QUOTATION: "Quotation",
  ATTRIBUTION: "Attribution corrected",
};

/** Interaction types a user can log by hand. */
export const LOGGABLE_ACTIVITY_TYPES = ["CALL", "MEETING", "VISIT", "WHATSAPP", "EMAIL", "NOTE"] as const;

export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  NONE: "Not submitted",
  PENDING: "Awaiting review",
  APPROVED: "Approved",
  REJECTED: "Changes requested",
};

/** Last 10 digits of a phone number — the duplicate-detection key. */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Effective quotation discount: total discount given as a % of the gross
 * (pre-discount) value. `subtotal` is the gross items value and
 * `discountAmount` the total of line discounts, as stored on the quotation.
 */
export function effectiveDiscountPercent(subtotal: number, discountAmount: number): number {
  if (!(subtotal > 0) || !(discountAmount > 0)) return 0;
  return Math.round(((discountAmount / subtotal) * 100 + Number.EPSILON) * 100) / 100;
}

/** Does a quotation need an approver for its discount, given the configured limit? */
export function discountNeedsApproval(discountPercent: number, limit: number | null): boolean {
  return limit !== null && discountPercent > limit + 1e-9;
}
