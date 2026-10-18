import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { leadScopeWhere } from "@/lib/sales-scope";
import { getSalesConfig } from "@/lib/services/sales-config";
import { OPEN_LEAD_STAGES, type LeadStageValue } from "@/lib/sales-config";
import { requireFirmId, type SessionUser } from "@/lib/session";

/**
 * Marketing & sales attribution report.
 *
 * Definitions (also rendered on the dashboard, see REPORT_DEFINITIONS):
 *  - Cohort: leads CREATED in the selected date range that match the other
 *    filters and are visible to the viewer. Everything below is measured on
 *    that cohort, so each number answers "what became of the leads we got in
 *    this period?".
 *  - Revenue: sum of `totalAmount` of NON-CANCELLED invoices created from
 *    quotations of cohort leads. Invoices are read directly (never joined
 *    through lead × quotation), so a lead with several quotations or invoices
 *    can never count the same invoice twice. Gross of sales returns.
 *  - Unavailable ≠ zero: campaign spend is nullable. Cost per lead and ROI are
 *    `null` — shown as "—" — whenever the spend (or a positive denominator) was
 *    not recorded, and blended totals only use campaigns that have spend.
 */

export interface MarketingFilters {
  from?: string;
  to?: string;
  campaignId?: string;
  channel?: string;
  salesperson?: string;
  location?: string;
}

export const REPORT_DEFINITIONS: { term: string; definition: string }[] = [
  { term: "Leads", definition: "Leads created in the selected date range that match the filters and that you are allowed to see." },
  { term: "Won / Lost", definition: "Leads whose current stage is Won (an invoice was raised or it was closed as won) or Lost." },
  { term: "Win rate", definition: "Won ÷ (Won + Lost). Open leads are excluded because their outcome is not known yet." },
  { term: "Lead → Won %", definition: "Won ÷ all leads in the cohort, including leads still open." },
  { term: "Revenue", definition: "Total of non-cancelled invoices raised from quotations of these leads. Each invoice is counted once. Gross of sales returns." },
  { term: "Cost per lead (CPL)", definition: "Recorded campaign spend ÷ leads from that campaign. Shown only for campaigns with spend recorded." },
  { term: "ROI", definition: "(Revenue − spend) ÷ spend. Shown only when spend is recorded and above zero." },
  { term: "Funnel conversion", definition: "Leads that reached a stage ÷ leads that reached the previous stage. A lead counts as having reached a stage if it ever entered it or any later open stage; Won counts as having passed every open stage." },
  { term: "Overdue follow-ups", definition: "Open leads whose next scheduled follow-up date is before today (ignores the date range)." },
  { term: "No recent activity", definition: "Open leads with no interaction for the configured number of days (ignores the date range)." },
];

const FUNNEL_STAGES: LeadStageValue[] = OPEN_LEAD_STAGES;
const rankOf = (stage: string) => FUNNEL_STAGES.indexOf(stage as LeadStageValue);

export interface BreakdownRow {
  key: string;
  label: string;
  leads: number;
  open: number;
  won: number;
  lost: number;
  winRate: number | null;
  leadToWon: number | null;
  quotations: number;
  leadsWithQuotation: number;
  revenue: number;
}

export interface CampaignRow extends BreakdownRow {
  campaignId: string;
  channel: string;
  status: string;
  budget: number | null;
  spend: number | null;
  costPerLead: number | null;
  roi: number | null;
}

const ratio = (num: number, den: number) => (den > 0 ? num / den : null);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function emptyRow(key: string, label: string): BreakdownRow {
  return { key, label, leads: 0, open: 0, won: 0, lost: 0, winRate: null, leadToWon: null, quotations: 0, leadsWithQuotation: 0, revenue: 0 };
}

function finalize(row: BreakdownRow) {
  row.winRate = ratio(row.won, row.won + row.lost);
  row.leadToWon = ratio(row.won, row.leads);
  row.revenue = round2(row.revenue);
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

interface CampaignRef {
  id: string;
  name: string;
  channel: string;
  status: string;
  budget: Prisma.Decimal | null;
  actualSpend: Prisma.Decimal | null;
}

/**
 * Lifetime performance of campaigns visible to the viewer. Spend is a lifetime
 * figure, so leads/revenue are lifetime too — otherwise cost per lead and ROI
 * would compare a whole budget with a slice of the results.
 */
export async function campaignMetrics(user: SessionUser, campaignsAll: CampaignRef[]): Promise<CampaignRow[]> {
  const firmId = requireFirmId(user);
  const ids = campaignsAll.map((c) => c.id);
  if (ids.length === 0) return [];
  const scopeWhere = leadScopeWhere(user);
  const [lifetimeLeads, lifetimeQuotes, lifetimeInvoices] = await Promise.all([
    prisma.lead.findMany({
      where: { AND: [scopeWhere, { campaignId: { in: ids } }] },
      select: { id: true, campaignId: true, stage: true },
    }),
    prisma.quotation.findMany({
      where: { lead: { AND: [scopeWhere, { campaignId: { in: ids } }] } },
      select: { id: true, leadId: true, lead: { select: { campaignId: true } } },
    }),
    prisma.invoice.findMany({
      where: { firmId, status: { not: "CANCELLED" }, quotation: { lead: { AND: [scopeWhere, { campaignId: { in: ids } }] } } },
      select: { id: true, totalAmount: true, quotation: { select: { lead: { select: { campaignId: true } } } } },
    }),
  ]);

  return campaignsAll
    .map((c) => {
      const row = emptyRow(c.id, c.name);
      const mine = lifetimeLeads.filter((l) => l.campaignId === c.id);
      row.leads = mine.length;
      row.won = mine.filter((l) => l.stage === "WON").length;
      row.lost = mine.filter((l) => l.stage === "LOST").length;
      row.open = row.leads - row.won - row.lost;
      const myQuotes = lifetimeQuotes.filter((q) => q.lead?.campaignId === c.id);
      row.quotations = myQuotes.length;
      row.leadsWithQuotation = new Set(myQuotes.map((q) => q.leadId)).size;
      row.revenue = lifetimeInvoices
        .filter((i) => i.quotation?.lead?.campaignId === c.id)
        .reduce((sum, i) => sum + Number(i.totalAmount), 0);
      finalize(row);
      const spend = c.actualSpend == null ? null : Number(c.actualSpend);
      return {
        ...row,
        campaignId: c.id,
        channel: c.channel,
        status: c.status,
        budget: c.budget == null ? null : Number(c.budget),
        spend,
        costPerLead: spend != null && row.leads > 0 ? round2(spend / row.leads) : null,
        roi: spend != null && spend > 0 ? round2((row.revenue - spend) / spend) : null,
      };
    })
    .sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label));
}

export async function getMarketingReport(user: SessionUser, filters: MarketingFilters) {
  const firmId = requireFirmId(user);
  const config = await getSalesConfig(firmId);

  // Filters other than the date range (reused for the "current state" numbers).
  const base: Prisma.LeadWhereInput[] = [leadScopeWhere(user)];
  if (filters.campaignId) base.push({ campaignId: filters.campaignId });
  if (filters.channel) {
    base.push({ OR: [{ campaign: { channel: filters.channel } }, { campaignId: null, source: filters.channel }] });
  }
  if (filters.salesperson === "unassigned") base.push({ assignedToId: null });
  else if (filters.salesperson) base.push({ assignedToId: filters.salesperson });
  if (filters.location?.trim()) base.push({ location: { equals: filters.location.trim(), mode: "insensitive" } });

  const dated: Prisma.LeadWhereInput[] = [...base];
  if (filters.from) dated.push({ createdAt: { gte: new Date(filters.from) } });
  if (filters.to) dated.push({ createdAt: { lt: new Date(new Date(filters.to).getTime() + 86_400_000) } });
  const cohort: Prisma.LeadWhereInput = { AND: dated };

  const today = startOfDay();
  const staleBefore = new Date(Date.now() - config.staleLeadDays * 86_400_000);
  const openWhere: Prisma.LeadWhereInput = { AND: [...base, { stage: { in: OPEN_LEAD_STAGES } }] };

  const [leads, quotations, invoices, stageEvents, overdue, stale, campaignsAll, users] = await Promise.all([
    prisma.lead.findMany({
      where: cohort,
      select: {
        id: true,
        source: true,
        campaignId: true,
        location: true,
        assignedToId: true,
        stage: true,
        lostReason: true,
        campaign: { select: { channel: true } },
      },
    }),
    prisma.quotation.findMany({ where: { lead: cohort }, select: { id: true, leadId: true } }),
    // One row per invoice — the source of truth for revenue.
    prisma.invoice.findMany({
      where: { firmId, status: { not: "CANCELLED" }, quotation: { lead: cohort } },
      select: { id: true, totalAmount: true, amountPaid: true, amountDue: true, quotation: { select: { leadId: true } } },
    }),
    prisma.leadActivity.findMany({ where: { type: "STAGE_CHANGE", lead: cohort }, select: { leadId: true, toStage: true } }),
    prisma.lead.count({ where: { AND: [openWhere, { nextFollowUpAt: { lt: today } }] } }),
    prisma.lead.count({ where: { AND: [openWhere, { lastActivityAt: { lt: staleBefore } }] } }),
    prisma.campaign.findMany({
      where: {
        firmId,
        ...(filters.campaignId ? { id: filters.campaignId } : {}),
        ...(filters.channel ? { channel: filters.channel } : {}),
      },
      select: { id: true, name: true, channel: true, status: true, budget: true, actualSpend: true },
    }),
    prisma.user.findMany({ where: { firmId }, select: { id: true, name: true } }),
  ]);

  const userName = new Map(users.map((u) => [u.id, u.name]));
  const leadById = new Map(leads.map((l) => [l.id, l]));

  // Per-lead facts.
  const quotesByLead = new Map<string, number>();
  for (const q of quotations) if (q.leadId) quotesByLead.set(q.leadId, (quotesByLead.get(q.leadId) ?? 0) + 1);
  const revenueByLead = new Map<string, number>();
  let totalRevenue = 0;
  let totalCollected = 0;
  let totalOutstanding = 0;
  const seenInvoices = new Set<string>();
  for (const inv of invoices) {
    if (seenInvoices.has(inv.id)) continue; // defensive: never count an invoice twice
    seenInvoices.add(inv.id);
    const leadId = inv.quotation?.leadId;
    if (!leadId) continue;
    const amount = Number(inv.totalAmount);
    revenueByLead.set(leadId, (revenueByLead.get(leadId) ?? 0) + amount);
    totalRevenue += amount;
    totalCollected += Number(inv.amountPaid);
    totalOutstanding += Number(inv.amountDue);
  }

  // Generic grouping.
  function group(keyOf: (l: (typeof leads)[number]) => { key: string; label: string }) {
    const rows = new Map<string, BreakdownRow>();
    for (const lead of leads) {
      const { key, label } = keyOf(lead);
      const row = rows.get(key) ?? emptyRow(key, label);
      row.leads += 1;
      if (lead.stage === "WON") row.won += 1;
      else if (lead.stage === "LOST") row.lost += 1;
      else row.open += 1;
      const q = quotesByLead.get(lead.id) ?? 0;
      row.quotations += q;
      if (q > 0) row.leadsWithQuotation += 1;
      row.revenue += revenueByLead.get(lead.id) ?? 0;
      rows.set(key, row);
    }
    const out = [...rows.values()];
    out.forEach(finalize);
    return out.sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label));
  }

  const bySource = group((l) => ({ key: l.source, label: l.source }));
  const byChannel = group((l) => {
    const channel = l.campaign?.channel ?? l.source;
    return { key: channel, label: channel };
  });
  const byLocation = group((l) => {
    const loc = l.location?.trim();
    return loc ? { key: loc.toLowerCase(), label: loc } : { key: "__none", label: "Not specified" };
  });
  const bySalesperson = group((l) =>
    l.assignedToId
      ? { key: l.assignedToId, label: userName.get(l.assignedToId) ?? "Former user" }
      : { key: "__unassigned", label: "Unassigned" },
  );

  const campaigns = (await campaignMetrics(user, campaignsAll)).filter(
    (c) => c.leads > 0 || !(filters.from || filters.to || filters.salesperson || filters.location),
  );

  // Blended spend metrics only over campaigns with recorded spend.
  const withSpend = campaigns.filter((c) => c.spend != null);
  const spendTotal = withSpend.length ? withSpend.reduce((s, c) => s + (c.spend ?? 0), 0) : null;
  const leadsWithSpend = withSpend.reduce((s, c) => s + c.leads, 0);
  const revenueWithSpend = withSpend.reduce((s, c) => s + c.revenue, 0);
  const blended = {
    campaignsTotal: campaigns.length,
    campaignsWithSpend: withSpend.length,
    spend: spendTotal === null ? null : round2(spendTotal),
    costPerLead: spendTotal !== null && leadsWithSpend > 0 ? round2(spendTotal / leadsWithSpend) : null,
    roi: spendTotal !== null && spendTotal > 0 ? round2((revenueWithSpend - spendTotal) / spendTotal) : null,
  };

  // Funnel (cumulative; see REPORT_DEFINITIONS).
  const visited = new Map<string, number>();
  for (const e of stageEvents) {
    const r = rankOf(e.toStage ?? "");
    if (r >= 0) visited.set(e.leadId, Math.max(visited.get(e.leadId) ?? 0, r));
  }
  const depthOf = (leadId: string) => {
    const lead = leadById.get(leadId)!;
    if (lead.stage === "WON") return FUNNEL_STAGES.length - 1;
    const current = rankOf(lead.stage);
    return Math.max(visited.get(leadId) ?? 0, current >= 0 ? current : 0);
  };
  const reached = FUNNEL_STAGES.map(() => 0);
  for (const lead of leads) {
    const depth = depthOf(lead.id);
    for (let i = 0; i <= depth; i++) reached[i] += 1;
  }
  const funnel = FUNNEL_STAGES.map((stage, i) => ({
    stage,
    reached: reached[i],
    fromPrevious: i === 0 ? null : ratio(reached[i], reached[i - 1]),
  }));

  const lostReasons = new Map<string, number>();
  for (const l of leads) if (l.stage === "LOST") lostReasons.set(l.lostReason ?? "No reason recorded", (lostReasons.get(l.lostReason ?? "No reason recorded") ?? 0) + 1);

  const totals = emptyRow("all", "All leads");
  for (const l of leads) {
    totals.leads += 1;
    if (l.stage === "WON") totals.won += 1;
    else if (l.stage === "LOST") totals.lost += 1;
    else totals.open += 1;
  }
  totals.quotations = quotations.length;
  totals.leadsWithQuotation = quotesByLead.size;
  totals.revenue = totalRevenue;
  finalize(totals);

  return {
    totals,
    collected: round2(totalCollected),
    outstanding: round2(totalOutstanding),
    blended,
    bySource,
    byChannel,
    byLocation,
    bySalesperson,
    campaigns,
    funnel,
    lostReasons: [...lostReasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    followUps: { overdue, stale, staleDays: config.staleLeadDays },
    filterOptions: {
      channels: config.campaignChannels,
      campaigns: campaignsAll.map((c) => ({ id: c.id, name: c.name })),
      salespeople: users,
    },
  };
}

export type MarketingReport = Awaited<ReturnType<typeof getMarketingReport>>;
