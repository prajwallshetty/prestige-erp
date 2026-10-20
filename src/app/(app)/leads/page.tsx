import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, Hourglass, Target } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { Pagination } from "@/components/shared/pagination";
import { SortHeader } from "@/components/shared/table-controls";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import { leadScopeWhere, canViewAllLeads } from "@/lib/sales-scope";
import { listLeads, listAssignableUsers, type LeadListFilters } from "@/lib/services/leads";
import { getSalesConfig } from "@/lib/services/sales-config";
import { LEAD_STAGES, LEAD_STAGE_LABELS, OPEN_LEAD_STAGES } from "@/lib/sales-config";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { parsePageParam } from "@/lib/utils";
import { NewLeadButton } from "./new-lead-button";

export const metadata = { title: "Leads — Technic Technologies" };

const FOLLOW_UP_FILTERS = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "none", label: "No follow-up set" },
  { value: "stale", label: "No recent activity" },
];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermissionInFirm(["leads.view", "leads.view_all"]);
  const params = await searchParams;
  const firmId = user.activeFirmId;
  const team = canViewAllLeads(user);
  const canCreate = user.permissions.includes("leads.create");
  const canAssign = user.permissions.includes("leads.assign");

  const filters: LeadListFilters = {
    q: params.q,
    stage: params.stage,
    source: params.source,
    campaignId: params.campaign,
    owner: team ? params.owner : undefined,
    followUp: (params.followUp as LeadListFilters["followUp"]) || "",
    location: params.location,
    from: params.from,
    to: params.to,
    sort: params.sort as LeadListFilters["sort"],
    dir: params.dir === "asc" ? "asc" : "desc",
    page: parsePageParam(params.page),
    pageSize: 25,
  };

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday.getTime() + 86_400_000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const scope = leadScopeWhere(user);
  const config = await getSalesConfig(firmId);
  const mine = team ? { assignedToId: user.id } : {};
  const open = { stage: { in: OPEN_LEAD_STAGES } } as const;

  const [result, openCount, dueToday, overdue, stale, wonThisMonth, campaigns, owners] = await Promise.all([
    listLeads(user, filters),
    prisma.lead.count({ where: { AND: [scope, mine, open] } }),
    prisma.lead.count({ where: { AND: [scope, mine, open, { nextFollowUpAt: { gte: startOfToday, lt: endOfToday } }] } }),
    prisma.lead.count({ where: { AND: [scope, mine, open, { nextFollowUpAt: { lt: startOfToday } }] } }),
    prisma.lead.count({
      where: { AND: [scope, mine, open, { lastActivityAt: { lt: new Date(Date.now() - config.staleLeadDays * 86_400_000) } }] },
    }),
    prisma.lead.count({ where: { AND: [scope, mine, { stage: "WON", wonAt: { gte: monthStart } }] } }),
    prisma.campaign.findMany({ where: { firmId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    team ? listAssignableUsers(firmId) : Promise.resolve([]),
  ]);

  type Row = (typeof result.rows)[number];
  const columns: Column<Row>[] = [
    {
      key: "lead",
      header: <SortHeader sortKey="name" label="Lead" />,
      cell: (row) => (
        <div className="min-w-0">
          <Link href={`/leads/${row.id}`} className="font-medium hover:text-primary hover:underline">
            {row.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {row.leadNumber} · <span className="numeric">{row.phone}</span>
          </p>
        </div>
      ),
    },
    { key: "location", header: "Location", hideOnMobile: true, cell: (row) => row.location ?? <span className="text-muted-foreground">—</span> },
    {
      key: "source",
      header: "Source",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-sm">
          <p>{row.source}</p>
          {row.campaign ? (
            <Link href={`/marketing/campaigns/${row.campaign.id}`} className="text-xs text-primary hover:underline">
              {row.campaign.name}
            </Link>
          ) : null}
        </div>
      ),
    },
    { key: "stage", header: "Stage", cell: (row) => <StatusBadge status={row.stage} label={LEAD_STAGE_LABELS[row.stage]} dot /> },
    ...(team
      ? [{ key: "owner", header: "Owner", hideOnMobile: true, cell: (row: Row) => row.assignedTo?.name ?? <span className="text-muted-foreground">Unassigned</span> } satisfies Column<Row>]
      : []),
    {
      key: "budget",
      header: <SortHeader sortKey="budget" label="Budget" align="right" />,
      headerClassName: "text-right",
      className: "text-right numeric",
      hideOnMobile: true,
      cell: (row) => (row.estimatedBudget ? formatCurrency(row.estimatedBudget) : <span className="text-muted-foreground">—</span>),
    },
    {
      key: "followup",
      header: <SortHeader sortKey="followup" label="Next follow-up" />,
      cell: (row) => {
        if (!OPEN_LEAD_STAGES.includes(row.stage as never)) return <span className="text-muted-foreground">—</span>;
        if (!row.nextFollowUpAt) return <span className="text-xs text-warning-foreground">Not scheduled</span>;
        const late = row.nextFollowUpAt < startOfToday;
        return (
          <span className={late ? "font-medium text-destructive" : "numeric"}>
            {formatDate(row.nextFollowUpAt)}
            {late ? " · overdue" : ""}
          </span>
        );
      },
    },
    { key: "quotes", header: "Quotes", hideOnMobile: true, className: "numeric", cell: (row) => row._count.quotations || "—" },
    { key: "created", header: <SortHeader sortKey="created" label="Created" />, hideOnMobile: true, cell: (row) => <span className="numeric">{formatDate(row.createdAt)}</span> },
  ];

  const hasFilters = Boolean(params.q || params.stage || params.source || params.campaign || params.owner || params.followUp || params.location);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads"
        description={team ? "All leads in your scope — assign, follow up and track the pipeline" : "Your leads and follow-ups"}
        actions={canCreate ? <NewLeadButton canAssign={canAssign} owners={owners} currentUserId={user.id} sources={config.leadSources} campaigns={campaigns} /> : null}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label={team ? "My open leads" : "Open leads"} value={openCount} icon={Target} href="/leads?owner=me" />
        <StatCard label="Follow-ups today" value={dueToday} icon={CalendarClock} tone="info" href="/leads?followUp=today" />
        <StatCard label="Overdue follow-ups" value={overdue} icon={AlertTriangle} tone={overdue > 0 ? "danger" : "default"} href="/leads?followUp=overdue" />
        <StatCard label={`No activity ${config.staleLeadDays}d+`} value={stale} icon={Hourglass} tone={stale > 0 ? "warning" : "default"} href="/leads?followUp=stale" />
        <StatCard label="Won this month" value={wonThisMonth} icon={CheckCircle2} tone="success" href="/leads?stage=WON" />
      </div>

      <FilterBar
        searchPlaceholder="Search name, phone, lead no., location…"
        showDateRange
        filters={[
          { name: "stage", label: "Stage", options: LEAD_STAGES.map((s) => ({ value: s, label: LEAD_STAGE_LABELS[s] })) },
          { name: "source", label: "Source", options: config.leadSources.map((s) => ({ value: s, label: s })) },
          { name: "campaign", label: "Campaign", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
          { name: "followUp", label: "Follow-up", options: FOLLOW_UP_FILTERS },
          ...(team
            ? [
                {
                  name: "owner",
                  label: "Owner",
                  options: [{ value: "me", label: "Mine" }, { value: "unassigned", label: "Unassigned" }, ...owners.map((o) => ({ value: o.id, label: o.name }))],
                },
              ]
            : []),
        ]}
      />

      <DataTable
        columns={columns}
        rows={result.rows}
        getRowKey={(row) => row.id}
        rowClassName={(row) =>
          OPEN_LEAD_STAGES.includes(row.stage as never) && row.nextFollowUpAt && row.nextFollowUpAt < startOfToday ? "bg-destructive/5" : undefined
        }
        empty={
          <EmptyState
            icon={Target}
            title={hasFilters ? "No leads match these filters" : "No leads yet"}
            description={hasFilters ? "Try clearing a filter." : canCreate ? "Add a lead from a walk-in, call, enquiry or referral." : "Leads assigned to you appear here."}
          />
        }
        renderMobileCard={(row) => (
          <Link href={`/leads/${row.id}`} className="block space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{row.name}</span>
              <StatusBadge status={row.stage} label={LEAD_STAGE_LABELS[row.stage]} />
            </div>
            <p className="text-sm text-muted-foreground">
              {row.leadNumber} · {row.phone}
              {row.location ? ` · ${row.location}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {row.source}
              {row.nextFollowUpAt && OPEN_LEAD_STAGES.includes(row.stage as never) ? ` · follow-up ${formatDate(row.nextFollowUpAt)}` : ""}
            </p>
          </Link>
        )}
      />
      <Pagination page={result.page} pageSize={result.pageSize} total={result.total} />
    </div>
  );
}
