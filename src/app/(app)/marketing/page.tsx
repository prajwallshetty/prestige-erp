import Link from "next/link";
import { AlertTriangle, FileText, Hourglass, IndianRupee, Megaphone, Percent, Target, TrendingUp, Trophy, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import { leadScopeWhere } from "@/lib/sales-scope";
import { getMarketingReport, REPORT_DEFINITIONS, type BreakdownRow } from "@/lib/services/marketing-report";
import { LEAD_STAGE_LABELS } from "@/lib/sales-config";
import { formatCompactCurrency, formatCurrency } from "@/lib/money";

export const metadata = { title: "Marketing — Technic Technologies" };

const UNAVAILABLE = "—";
const pct = (v: number | null, digits = 0) => (v == null ? UNAVAILABLE : `${(v * 100).toFixed(digits)}%`);
const inr = (v: number | null) => (v == null ? UNAVAILABLE : formatCurrency(v));
const inrCompact = (v: number | null) => (v == null ? UNAVAILABLE : formatCompactCurrency(v));

export default async function MarketingDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermissionInFirm("marketing.view");
  const params = await searchParams;

  const filters = {
    from: params.from,
    to: params.to,
    campaignId: params.campaign,
    channel: params.channel,
    salesperson: params.salesperson,
    location: params.location,
  };
  const [report, locations] = await Promise.all([
    getMarketingReport(user, filters),
    prisma.lead.groupBy({ by: ["location"], where: { AND: [leadScopeWhere(user), { location: { not: null } }] }, _count: true, orderBy: { _count: { location: "desc" } }, take: 40 }),
  ]);

  const { totals, blended, funnel, followUps } = report;
  const activeFilters = Object.values(filters).some(Boolean);
  const salespeople = report.filterOptions.salespeople;
  const canManage = user.permissions.includes("marketing.manage");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Marketing dashboard"
        description="Where leads come from, what they become, and what each campaign returns"
        actions={
          <>
            <Button asChild variant="outline"><Link href="/marketing/campaigns"><Megaphone /> Campaigns</Link></Button>
            {canManage ? <Button asChild variant="outline"><Link href="/marketing/segments">Customer segments</Link></Button> : null}
          </>
        }
      />

      <FilterBar
        showSearch={false}
        showDateRange
        filters={[
          { name: "campaign", label: "Campaign", options: report.filterOptions.campaigns.map((c) => ({ value: c.id, label: c.name })) },
          { name: "channel", label: "Channel", options: report.filterOptions.channels.map((c) => ({ value: c, label: c })) },
          { name: "salesperson", label: "Salesperson", options: [{ value: "unassigned", label: "Unassigned" }, ...salespeople.map((p) => ({ value: p.id, label: p.name }))] },
          { name: "location", label: "Location", options: locations.filter((l) => l.location).map((l) => ({ value: l.location!, label: `${l.location} (${l._count})` })) },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        Showing leads created {params.from || params.to ? `${params.from ? `from ${params.from} ` : ""}${params.to ? `to ${params.to}` : ""}` : "at any time"}
        {activeFilters ? " matching the filters" : ""}. Open the definitions at the bottom for how each figure is calculated.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Leads" value={totals.leads} icon={Users} hint={`${totals.open} open`} />
        <StatCard label="Quotations" value={totals.quotations} icon={FileText} hint={`${totals.leadsWithQuotation} leads quoted`} />
        <StatCard label="Won" value={totals.won} icon={Trophy} tone="success" hint={`${totals.lost} lost`} />
        <StatCard label="Win rate" value={pct(totals.winRate)} icon={Target} animate={false} hint={totals.winRate == null ? "No closed leads yet" : "Won ÷ closed"} />
        <StatCard label="Attributed revenue" value={formatCompactCurrency(report.totals.revenue)} icon={IndianRupee} tone="success" animate={false} hint={`${formatCompactCurrency(report.collected)} collected`} />
        <StatCard
          label="Recorded spend"
          value={inrCompact(blended.spend)}
          icon={Megaphone}
          animate={false}
          hint={blended.campaignsTotal === 0 ? "No campaigns" : `${blended.campaignsWithSpend} of ${blended.campaignsTotal} campaigns`}
        />
        <StatCard label="Cost per lead" value={inrCompact(blended.costPerLead)} icon={Percent} animate={false} hint={blended.costPerLead == null ? "Needs spend data" : "With spend only"} />
        <StatCard label="Campaign ROI" value={pct(blended.roi)} icon={TrendingUp} animate={false} tone={blended.roi != null && blended.roi < 0 ? "danger" : "default"} hint={blended.roi == null ? "Needs spend data" : "With spend only"} />
        <StatCard label="Overdue follow-ups" value={followUps.overdue} icon={AlertTriangle} tone={followUps.overdue > 0 ? "danger" : "default"} href="/leads?followUp=overdue" />
        <StatCard label={`No activity ${followUps.staleDays}d+`} value={followUps.stale} icon={Hourglass} tone={followUps.stale > 0 ? "warning" : "default"} href="/leads?followUp=stale" />
      </div>

      {totals.leads === 0 ? (
        <EmptyState icon={Target} title="No leads in this view" description={activeFilters ? "Widen the date range or clear a filter." : "Leads captured by the sales team will be analysed here."} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Pipeline conversion</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {funnel.map((step) => (
                  <div key={step.stage} className="space-y-1">
                    <div className="flex items-baseline justify-between text-sm">
                      <span>{LEAD_STAGE_LABELS[step.stage]}</span>
                      <span className="numeric">
                        <strong>{step.reached}</strong>
                        <span className="ml-2 text-xs text-muted-foreground">{step.fromPrevious == null ? "" : `${pct(step.fromPrevious)} of previous`}</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${totals.leads ? (step.reached / totals.leads) * 100 : 0}%` }} /></div>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Why leads were lost</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {report.lostReasons.length === 0 ? <p className="text-muted-foreground">No lost leads in this view.</p> : report.lostReasons.map((r) => (
                  <div key={r.reason} className="flex items-center justify-between gap-2"><span>{r.reason}</span><span className="numeric font-medium">{r.count}</span></div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Breakdown title="Campaign performance" subtitle="Lifetime totals per campaign" rows={report.campaigns} first="Campaign" campaigns link={(r) => `/marketing/campaigns/${r.key}`} />
          <Breakdown title="By lead source" rows={report.bySource} first="Source" />
          <Breakdown title="By channel" subtitle="A lead's channel is its campaign's channel, or its source when it has no campaign" rows={report.byChannel} first="Channel" />
          <Breakdown title="By location" rows={report.byLocation} first="Location" />
          <Breakdown title="By salesperson" rows={report.bySalesperson} first="Salesperson" />
        </>
      )}

      <details className="rounded-xl border border-border bg-card p-4 text-sm">
        <summary className="cursor-pointer font-medium">Definitions &amp; formulas</summary>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {REPORT_DEFINITIONS.map((d) => (
            <div key={d.term}><dt className="font-medium">{d.term}</dt><dd className="text-muted-foreground">{d.definition}</dd></div>
          ))}
        </dl>
        <p className="mt-3 text-muted-foreground">“—” means the figure cannot be calculated (for example, spend was not recorded). It is never shown as zero.</p>
      </details>
    </div>
  );
}

function Breakdown({
  title,
  subtitle,
  rows,
  first,
  campaigns,
  link,
}: {
  title: string;
  subtitle?: string;
  rows: (BreakdownRow & Partial<{ spend: number | null; costPerLead: number | null; roi: number | null; channel: string }>)[];
  first: string;
  campaigns?: boolean;
  link?: (row: BreakdownRow) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.leads));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <p className="px-4 pb-2 text-sm text-muted-foreground">Nothing to show for this view.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{first}</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Quoted</TableHead>
                  <TableHead className="text-right">Won</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Lost</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Win rate</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  {campaigns ? (
                    <>
                      <TableHead className="hidden text-right md:table-cell">Spend</TableHead>
                      <TableHead className="hidden text-right md:table-cell">CPL</TableHead>
                      <TableHead className="pr-4 text-right">ROI</TableHead>
                    </>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="pl-4">
                      {link ? <Link href={link(row)} className="font-medium text-primary hover:underline">{row.label}</Link> : <span className="font-medium">{row.label}</span>}
                      {row.channel ? <span className="ml-2 text-xs text-muted-foreground">{row.channel}</span> : null}
                      <div className="mt-1 h-1 w-24 rounded-full bg-muted"><div className="h-1 rounded-full bg-primary/70" style={{ width: `${(row.leads / max) * 100}%` }} /></div>
                    </TableCell>
                    <TableCell className="text-right numeric">{row.leads}</TableCell>
                    <TableCell className="hidden text-right numeric sm:table-cell">{row.leadsWithQuotation}</TableCell>
                    <TableCell className="text-right numeric">{row.won}</TableCell>
                    <TableCell className="hidden text-right numeric sm:table-cell">{row.lost}</TableCell>
                    <TableCell className="hidden text-right numeric md:table-cell">{pct(row.winRate)}</TableCell>
                    <TableCell className="text-right numeric">{formatCurrency(row.revenue)}</TableCell>
                    {campaigns ? (
                      <>
                        <TableCell className="hidden text-right numeric md:table-cell" title={row.spend == null ? "Spend not recorded" : undefined}>{inr(row.spend ?? null)}</TableCell>
                        <TableCell className="hidden text-right numeric md:table-cell">{inr(row.costPerLead ?? null)}</TableCell>
                        <TableCell className="pr-4 text-right numeric">{pct(row.roi ?? null)}</TableCell>
                      </>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
