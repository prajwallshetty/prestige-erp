import Link from "next/link";
import { Megaphone } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { requirePermissionInFirm } from "@/lib/session";
import { listCampaigns, listMarketingOwners } from "@/lib/services/campaigns";
import { campaignMetrics } from "@/lib/services/marketing-report";
import { getSalesConfig } from "@/lib/services/sales-config";
import { CAMPAIGN_STATUS_LABELS } from "@/lib/sales-config";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { CampaignFormButton } from "./campaign-form";

export const metadata = { title: "Campaigns — Technic Technologies" };

const dash = <span className="text-muted-foreground" title="Not recorded">—</span>;

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermissionInFirm("marketing.view");
  const params = await searchParams;
  const canManage = user.permissions.includes("marketing.manage");

  const [campaigns, config, owners] = await Promise.all([
    listCampaigns(user, { q: params.q, status: params.status, channel: params.channel, ownerId: params.owner }),
    getSalesConfig(user.activeFirmId),
    listMarketingOwners(user.activeFirmId),
  ]);
  const metrics = new Map((await campaignMetrics(user, campaigns)).map((m) => [m.campaignId, m]));

  type Row = (typeof campaigns)[number];
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Campaign",
      cell: (c) => (
        <div className="min-w-0">
          <Link href={`/marketing/campaigns/${c.id}`} className="font-medium hover:text-primary hover:underline">{c.name}</Link>
          <p className="text-xs text-muted-foreground">{c.type} · {c.channel}</p>
        </div>
      ),
    },
    { key: "status", header: "Status", cell: (c) => <StatusBadge status={c.status} label={CAMPAIGN_STATUS_LABELS[c.status]} dot /> },
    {
      key: "period",
      header: "Period",
      hideOnMobile: true,
      cell: (c) => (c.startDate || c.endDate ? <span className="numeric text-sm">{c.startDate ? formatDate(c.startDate) : "…"} – {c.endDate ? formatDate(c.endDate) : "ongoing"}</span> : dash),
    },
    { key: "owner", header: "Owner", hideOnMobile: true, cell: (c) => c.owner?.name ?? dash },
    { key: "leads", header: "Leads", className: "numeric text-right", headerClassName: "text-right", cell: (c) => metrics.get(c.id)?.leads ?? 0 },
    { key: "won", header: "Won", className: "numeric text-right", headerClassName: "text-right", hideOnMobile: true, cell: (c) => metrics.get(c.id)?.won ?? 0 },
    { key: "budget", header: "Budget", className: "numeric text-right", headerClassName: "text-right", hideOnMobile: true, cell: (c) => (c.budget != null ? formatCurrency(c.budget) : dash) },
    { key: "spend", header: "Spend", className: "numeric text-right", headerClassName: "text-right", hideOnMobile: true, cell: (c) => (c.actualSpend != null ? formatCurrency(c.actualSpend) : dash) },
    {
      key: "revenue",
      header: "Revenue",
      className: "numeric text-right",
      headerClassName: "text-right",
      cell: (c) => formatCurrency(metrics.get(c.id)?.revenue ?? 0),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Campaigns"
        description="Plan campaigns, record spend and see the leads and revenue each one produced"
        actions={canManage ? <CampaignFormButton channels={config.campaignChannels} owners={owners} /> : null}
      />
      <FilterBar
        searchPlaceholder="Search campaigns…"
        filters={[
          { name: "status", label: "Status", options: Object.entries(CAMPAIGN_STATUS_LABELS).map(([value, label]) => ({ value, label })) },
          { name: "channel", label: "Channel", options: config.campaignChannels.map((c) => ({ value: c, label: c })) },
          { name: "owner", label: "Owner", options: owners.map((o) => ({ value: o.id, label: o.name })) },
        ]}
      />
      <DataTable
        columns={columns}
        rows={campaigns}
        getRowKey={(c) => c.id}
        empty={
          <EmptyState
            icon={Megaphone}
            title={params.q || params.status || params.channel ? "No campaigns match these filters" : "No campaigns yet"}
            description={canManage ? "Create a campaign, then tag new leads with it to see what each rupee of spend returns." : "Campaigns created by the marketing team appear here."}
          />
        }
        renderMobileCard={(c) => (
          <Link href={`/marketing/campaigns/${c.id}`} className="block space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{c.name}</span>
              <StatusBadge status={c.status} label={CAMPAIGN_STATUS_LABELS[c.status]} />
            </div>
            <p className="text-sm text-muted-foreground">{c.channel} · {metrics.get(c.id)?.leads ?? 0} leads · {formatCurrency(metrics.get(c.id)?.revenue ?? 0)}</p>
          </Link>
        )}
      />
    </div>
  );
}
