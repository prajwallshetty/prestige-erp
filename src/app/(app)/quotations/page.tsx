import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { Pagination } from "@/components/shared/pagination";
import { SortHeader } from "@/components/shared/table-controls";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm, type SessionUser } from "@/lib/session";
import { isOwnQuotationsOnly, leadScopeWhere, quotationScopeWhere } from "@/lib/sales-scope";
import { isPlatformRole } from "@/lib/rbac";
import { NewQuotationButton } from "./new-quotation-button";
import { DeleteQuotationButton } from "./delete-quotation-button";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { parsePageParam } from "@/lib/utils";
import { QUOTATION_STATUS_LABELS } from "@/lib/workflow";
import { REVIEW_STATUS_LABELS } from "@/lib/sales-config";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Quotations — Technic Technologies" };

function quotationMode(user: SessionUser): "GST" | "NON_GST" {
  return user.permissions.includes("gst_reports.view") ? "GST" : "NON_GST";
}

const QUOTATION_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"] as const;
const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermissionInFirm("quotation.view");
  const params = await searchParams;
  const page = parsePageParam(params.page);
  const pageSize = 25;

  const status = QUOTATION_STATUSES.find((s) => s === params.status);
  const review = REVIEW_STATUSES.find((s) => s === params.review);
  const ownOnly = isOwnQuotationsOnly(user);
  const canSeeTeam = !ownOnly;

  const and: Prisma.QuotationWhereInput[] = [quotationScopeWhere(user)];
  if (status) and.push({ status });
  if (review) and.push({ reviewStatus: review });
  if (params.owner === "me") and.push({ OR: [{ assignedToId: user.id }, { createdById: user.id }] });
  else if (params.owner && canSeeTeam) and.push({ assignedToId: params.owner });
  if (params.q?.trim()) {
    const q = params.q.trim();
    and.push({
      OR: [
        { quotationNumber: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { customer: { phone: { contains: q } } },
        { lead: { leadNumber: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  if (params.from) and.push({ quotationDate: { gte: new Date(params.from) } });
  if (params.to) and.push({ quotationDate: { lt: new Date(new Date(params.to).getTime() + 86_400_000) } });
  const where: Prisma.QuotationWhereInput = { AND: and };

  const dir = params.dir === "asc" ? "asc" : "desc";
  const orderBy: Prisma.QuotationOrderByWithRelationInput =
    params.sort === "total" ? { totalAmount: dir } : params.sort === "number" ? { quotationNumber: dir } : { quotationDate: dir };

  const canCreate = user.permissions.includes("quotation.create");
  const canAssign = user.permissions.includes("leads.assign");

  // "New quotation for this lead" deep link from the lead page.
  const leadId = params.lead;
  const [total, quotations, salespeople, leadForQuote, awaitingReview] = await Promise.all([
    prisma.quotation.count({ where }),
    prisma.quotation.findMany({
      where,
      orderBy: [orderBy, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { name: true } },
        lead: { select: { id: true, leadNumber: true } },
        assignedTo: { select: { name: true } },
        convertedInvoices: { select: { id: true, invoiceNumber: true }, take: 1 },
      },
    }),
    canSeeTeam
      ? prisma.user.findMany({
          where: { firmId: user.activeFirmId, status: "ACTIVE", role: { in: ["SALES_STAFF", "MANAGER", "ADMIN"] } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    leadId && canCreate
      ? prisma.lead.findFirst({
          where: { id: leadId, ...leadScopeWhere(user) },
          select: { id: true, leadNumber: true, name: true, customer: { select: { id: true, name: true, phone: true } } },
        })
      : Promise.resolve(null),
    user.permissions.includes("quotation.review")
      ? prisma.quotation.count({ where: { AND: [quotationScopeWhere(user), { reviewStatus: "PENDING" }] } })
      : Promise.resolve(0),
  ]);

  interface Row {
    id: string;
    number: string;
    customer: string;
    lead: { id: string; number: string } | null;
    owner: string | null;
    date: Date;
    total: number;
    status: string;
    review: string;
    taxMode: string;
    invoice: { id: string; number: string } | null;
  }

  const rows: Row[] = quotations.map((quotation) => ({
    id: quotation.id,
    number: quotation.quotationNumber,
    customer: quotation.customer.name,
    lead: quotation.lead ? { id: quotation.lead.id, number: quotation.lead.leadNumber } : null,
    owner: quotation.assignedTo?.name ?? null,
    date: quotation.quotationDate,
    total: Number(quotation.totalAmount),
    status: quotation.status,
    review: quotation.reviewStatus,
    taxMode: quotation.taxMode,
    invoice: quotation.convertedInvoices[0]
      ? { id: quotation.convertedInvoices[0].id, number: quotation.convertedInvoices[0].invoiceNumber }
      : null,
  }));

  const canEdit =
    user.permissions.includes("quotation.create") ||
    user.permissions.includes("sales.edit") ||
    user.permissions.includes("quotation.edit");
  const canDelete =
    user.permissions.includes("quotation.delete") ||
    user.permissions.includes("sales.edit") ||
    user.permissions.includes("quotation.edit");
  const canConvert = user.permissions.includes("quotation.convert");
  const convertible = (row: Row) => canConvert && !["CONVERTED", "REJECTED", "EXPIRED"].includes(row.status);
  const canSwitchMode = isPlatformRole(user.role);

  const columns: Column<Row>[] = [
    {
      key: "number",
      header: <SortHeader sortKey="number" label="Quotation #" />,
      cell: (row) => (
        <Link href={`/quotations/${row.id}`} className="font-medium hover:text-primary hover:underline">
          {row.number}
        </Link>
      ),
    },
    { key: "customer", header: "Customer", cell: (row) => <span className="line-clamp-1">{row.customer}</span> },
    {
      key: "lead",
      header: "Lead",
      hideOnMobile: true,
      cell: (row) =>
        row.lead ? (
          <Link href={`/leads/${row.lead.id}`} className="text-primary hover:underline">{row.lead.number}</Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    ...(canSeeTeam
      ? [{ key: "owner", header: "Salesperson", hideOnMobile: true, cell: (row: Row) => row.owner ?? "—" } satisfies Column<Row>]
      : []),
    { key: "date", header: <SortHeader sortKey="date" label="Date" />, hideOnMobile: true, cell: (row) => <span className="numeric">{formatDate(row.date)}</span> },
    {
      key: "total",
      header: <SortHeader sortKey="total" label="Total" align="right" />,
      headerClassName: "text-right",
      className: "text-right numeric",
      cell: (row) => formatCurrency(row.total),
    },
    {
      key: "mode",
      header: "Mode",
      hideOnMobile: true,
      cell: (row) => <Badge tone={row.taxMode === "GST" ? "info" : "neutral"}>{row.taxMode === "GST" ? "GST" : "Non-Tax"}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge status={row.status} label={QUOTATION_STATUS_LABELS[row.status] ?? row.status} dot />
          {row.review === "PENDING" ? <StatusBadge status="PENDING" label="Review" tone="warning" /> : null}
          {row.review === "REJECTED" ? <StatusBadge status="REJECTED" label="Sent back" tone="danger" /> : null}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      headerClassName: "text-right",
      className: "text-right",
      cell: (row) =>
        row.status !== "CONVERTED" ? (
          <div className="flex items-center justify-end gap-1.5">
            {canEdit ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/quotations/${row.id}?edit=true`}>Edit</Link>
              </Button>
            ) : null}
            {canDelete && (row.status === "DRAFT" || user.permissions.includes("quotation.review")) ? (
              <DeleteQuotationButton quotationId={row.id} quotationNumber={row.number} size="sm" variant="outline" />
            ) : null}
            {convertible(row) ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/quotations/${row.id}/convert`}>Convert</Link>
              </Button>
            ) : null}
          </div>
        ) : row.invoice ? (
          <Link href={`/invoices/${row.invoice.id}`} className="text-sm text-primary hover:underline">{row.invoice.number}</Link>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Quotations"
        description={
          ownOnly
            ? "Your quotations — a manager reviews them and converts the approved ones to invoices"
            : "Team quotations — review, approve discounts and convert to invoices"
        }
        actions={
          canCreate ? (
            <NewQuotationButton
              taxMode={quotationMode(user)}
              canSwitchMode={canSwitchMode}
              salespeople={canAssign ? salespeople : []}
              currentUserId={user.id}
              defaultOpen={Boolean(leadForQuote)}
              lead={
                leadForQuote
                  ? {
                      leadId: leadForQuote.id,
                      label: `${leadForQuote.leadNumber} · ${leadForQuote.name}`,
                      customer: leadForQuote.customer,
                    }
                  : undefined
              }
            />
          ) : null
        }
      />

      {awaitingReview > 0 && !review ? (
        <Link
          href="/quotations?review=PENDING"
          className="flex items-center justify-between rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm hover:bg-warning/15"
        >
          <span>
            <strong className="numeric">{awaitingReview}</strong> quotation{awaitingReview === 1 ? "" : "s"} awaiting your review
          </span>
          <span className="text-primary">Review →</span>
        </Link>
      ) : null}

      <FilterBar
        searchPlaceholder="Search number, customer, phone or lead…"
        showDateRange
        filters={[
          {
            name: "status",
            label: "Status",
            options: QUOTATION_STATUSES.map((s) => ({ value: s, label: QUOTATION_STATUS_LABELS[s] })),
          },
          {
            name: "review",
            label: "Review",
            options: REVIEW_STATUSES.map((s) => ({ value: s, label: REVIEW_STATUS_LABELS[s] })),
          },
          ...(canSeeTeam
            ? [
                {
                  name: "owner",
                  label: "Salesperson",
                  options: [{ value: "me", label: "Mine" }, ...salespeople.map((p) => ({ value: p.id, label: p.name }))],
                },
              ]
            : []),
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={
          <EmptyState
            title={params.q || status || review ? "No quotations match these filters" : "No quotations yet"}
            description={
              canCreate ? "Open a lead and use “Create quotation”, or use “New quotation”." : "Quotations raised by the sales team appear here."
            }
          />
        }
        renderMobileCard={(row) => (
          <div className="space-y-1">
            <Link href={`/quotations/${row.id}`} className="block">
              <div className="flex items-center justify-between">
                <span className="font-medium">{row.number}</span>
                <StatusBadge status={row.status} label={QUOTATION_STATUS_LABELS[row.status] ?? row.status} />
              </div>
              <p className="text-sm text-muted-foreground">
                {row.customer}
                {row.owner && canSeeTeam ? ` · ${row.owner}` : ""}
              </p>
              <div className="flex items-center justify-between text-sm">
                <span>{formatDate(row.date)}</span>
                <span className="numeric font-semibold">{formatCurrency(row.total)}</span>
              </div>
            </Link>
            {row.status !== "CONVERTED" ? (
              <div className="flex items-center gap-2 pt-1">
                {canEdit ? (
                  <Button asChild size="sm" variant="outline" className="flex-1">
                    <Link href={`/quotations/${row.id}?edit=true`}>Edit</Link>
                  </Button>
                ) : null}
                {convertible(row) ? (
                  <Button asChild size="sm" variant="outline" className="flex-1">
                    <Link href={`/quotations/${row.id}/convert`}>Convert</Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      />
      <Pagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
