import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, IndianRupee, Percent, Target, TrendingUp, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import { leadScopeWhere } from "@/lib/sales-scope";
import { campaignMetrics } from "@/lib/services/marketing-report";
import { listMarketingOwners } from "@/lib/services/campaigns";
import { getSalesConfig } from "@/lib/services/sales-config";
import { CAMPAIGN_STATUS_LABELS, LEAD_STAGE_LABELS } from "@/lib/sales-config";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { CampaignFormButton } from "../campaign-form";

export const metadata = { title: "Campaign — Technic Technologies" };

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const money = (v: unknown) => (v == null ? "" : String(Number(v)));

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionInFirm("marketing.view");
  const { id } = await params;
  const campaign = await prisma.campaign.findFirst({
    where: { id, firmId: user.activeFirmId },
    include: { owner: { select: { id: true, name: true } }, createdBy: { select: { name: true } } },
  });
  if (!campaign) notFound();

  const canManage = user.permissions.includes("marketing.manage");
  const [[metrics], config, owners, leads] = await Promise.all([
    campaignMetrics(user, [campaign]),
    getSalesConfig(user.activeFirmId),
    canManage ? listMarketingOwners(user.activeFirmId) : Promise.resolve([]),
    prisma.lead.findMany({
      where: { AND: [leadScopeWhere(user), { campaignId: campaign.id }] },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, leadNumber: true, name: true, stage: true, location: true, createdAt: true, assignedTo: { select: { name: true } } },
    }),
  ]);

  const unknown = "—";
  const fmtPct = (v: number | null) => (v == null ? unknown : `${(v * 100).toFixed(0)}%`);

  return (
    <div className="space-y-4">
      <PageHeader
        title={campaign.name}
        description={`${campaign.type} · ${campaign.channel}${campaign.owner ? ` · Owner: ${campaign.owner.name}` : ""}`}
        backButton={<Button asChild variant="ghost" size="sm"><Link href="/marketing/campaigns"><ArrowLeft className="mr-2 h-4 w-4" /> Campaigns</Link></Button>}
        actions={
          <>
            <Button asChild variant="outline"><Link href={`/marketing?campaign=${campaign.id}`}>Open in dashboard</Link></Button>
            {canManage ? (
              <CampaignFormButton
                channels={[...new Set([campaign.channel, ...config.campaignChannels])]}
                owners={owners}
                initial={{
                  id: campaign.id,
                  name: campaign.name,
                  description: campaign.description ?? "",
                  type: campaign.type,
                  channel: campaign.channel,
                  status: campaign.status,
                  startDate: iso(campaign.startDate),
                  endDate: iso(campaign.endDate),
                  targetAudience: campaign.targetAudience ?? "",
                  targetLocation: campaign.targetLocation ?? "",
                  budget: money(campaign.budget),
                  actualSpend: money(campaign.actualSpend),
                  notes: campaign.notes ?? "",
                  ownerId: campaign.ownerId ?? "__none",
                  isPromotion: campaign.isPromotion,
                  offerValidFrom: iso(campaign.offerValidFrom),
                  offerValidTo: iso(campaign.offerValidTo),
                  discountType: campaign.discountType ?? "PERCENT",
                  discountValue: money(campaign.discountValue),
                  minOrderValue: money(campaign.minOrderValue),
                  promoCode: campaign.promoCode ?? "",
                }}
              />
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <StatusBadge status={campaign.status} label={CAMPAIGN_STATUS_LABELS[campaign.status]} dot />
        {campaign.startDate || campaign.endDate ? <span>{campaign.startDate ? formatDate(campaign.startDate) : "…"} – {campaign.endDate ? formatDate(campaign.endDate) : "ongoing"}</span> : null}
        {campaign.targetLocation ? <span>Target: {campaign.targetLocation}</span> : null}
        {campaign.targetAudience ? <span>Audience: {campaign.targetAudience}</span> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Leads" value={metrics.leads} icon={Users} hint={`${metrics.won} won · ${metrics.lost} lost · ${metrics.open} open`} />
        <StatCard label="Quotations" value={metrics.quotations} icon={Target} hint={`${metrics.leadsWithQuotation} leads quoted`} />
        <StatCard label="Revenue" value={formatCurrency(metrics.revenue)} icon={IndianRupee} tone="success" hint="Non-cancelled invoices" />
        <StatCard label="Cost per lead" value={metrics.costPerLead == null ? unknown : formatCurrency(metrics.costPerLead)} icon={Percent} hint={metrics.spend == null ? "Spend not recorded" : `Spend ${formatCurrency(metrics.spend)}`} animate={false} />
        <StatCard label="ROI" value={fmtPct(metrics.roi)} icon={TrendingUp} tone={metrics.roi != null && metrics.roi < 0 ? "danger" : "default"} hint={metrics.roi == null ? "Needs recorded spend above zero" : "(Revenue − spend) ÷ spend"} animate={false} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Leads from this campaign</CardTitle></CardHeader>
          <CardContent className="px-0">
            {leads.length === 0 ? (
              <p className="px-4 pb-2 text-sm text-muted-foreground">No leads are tagged with this campaign yet. Choose it as the campaign when adding a lead.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Lead</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead className="hidden sm:table-cell">Location</TableHead>
                      <TableHead className="hidden sm:table-cell">Salesperson</TableHead>
                      <TableHead className="pr-4">Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell className="pl-4"><Link href={`/leads/${lead.id}`} className="font-medium text-primary hover:underline">{lead.name}</Link><span className="ml-2 text-xs text-muted-foreground">{lead.leadNumber}</span></TableCell>
                        <TableCell><StatusBadge status={lead.stage} label={LEAD_STAGE_LABELS[lead.stage]} /></TableCell>
                        <TableCell className="hidden sm:table-cell">{lead.location ?? unknown}</TableCell>
                        <TableCell className="hidden sm:table-cell">{lead.assignedTo?.name ?? unknown}</TableCell>
                        <TableCell className="pr-4 numeric">{formatDate(lead.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Budget</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Budget: <span className="numeric font-medium">{campaign.budget != null ? formatCurrency(campaign.budget) : unknown}</span></p>
              <p>Actual spend: <span className="numeric font-medium">{campaign.actualSpend != null ? formatCurrency(campaign.actualSpend) : "Not recorded"}</span></p>
              {campaign.budget != null && campaign.actualSpend != null && Number(campaign.actualSpend) > Number(campaign.budget) ? (
                <p className="text-destructive">Over budget by {formatCurrency(Number(campaign.actualSpend) - Number(campaign.budget))}</p>
              ) : null}
            </CardContent>
          </Card>
          {campaign.isPromotion ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Offer</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="font-medium">
                  {campaign.discountType === "PERCENT" ? `${Number(campaign.discountValue)}% off` : `${formatCurrency(campaign.discountValue)} off`}
                  {campaign.minOrderValue ? ` on orders above ${formatCurrency(campaign.minOrderValue)}` : ""}
                </p>
                <p className="text-muted-foreground">
                  Valid {campaign.offerValidFrom ? formatDate(campaign.offerValidFrom) : "from launch"} – {campaign.offerValidTo ? formatDate(campaign.offerValidTo) : "until withdrawn"}
                  {campaign.offerValidTo && campaign.offerValidTo < new Date() ? " (expired)" : ""}
                </p>
                {campaign.promoCode ? <p>Code: <span className="font-mono">{campaign.promoCode}</span></p> : null}
                <p className="pt-1 text-xs text-muted-foreground">Discounts are applied manually on quotations; the quotation approval limit still applies. Performance of the offer is the campaign&apos;s lead and revenue figures above.</p>
              </CardContent>
            </Card>
          ) : null}
          {campaign.description || campaign.notes ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Notes</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                {campaign.description ? <p>{campaign.description}</p> : null}
                {campaign.notes ? <p>{campaign.notes}</p> : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
