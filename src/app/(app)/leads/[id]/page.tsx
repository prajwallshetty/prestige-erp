import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermissionInFirm } from "@/lib/session";
import { getLeadDetail, listAssignableUsers } from "@/lib/services/leads";
import { getSalesConfig } from "@/lib/services/sales-config";
import { NotFoundError } from "@/lib/action-result";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { LEAD_ACTIVITY_LABELS, LEAD_STAGE_LABELS, REVIEW_STATUS_LABELS } from "@/lib/sales-config";
import { QUOTATION_STATUS_LABELS, INVOICE_STATUS_LABELS } from "@/lib/workflow";
import {
  AssignControl,
  AttributionButton,
  CreateQuotationButton,
  EditLeadButton,
  FollowUpPanel,
  LogActivityForm,
  StageControl,
} from "./lead-panels";

export const metadata = { title: "Lead — Technic Technologies" };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionInFirm(["leads.view", "leads.view_all"]);
  const { id } = await params;

  let lead;
  try {
    lead = await getLeadDetail(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const canEdit = user.permissions.includes("leads.edit");
  const canAssign = user.permissions.includes("leads.assign");
  const canQuote = user.permissions.includes("quotation.create");
  const canCorrectAttribution = user.permissions.includes("marketing.manage") || canAssign;
  const canViewQuotations = user.permissions.includes("quotation.view");
  const canViewInvoices = user.permissions.includes("invoice.view");

  const [config, owners, campaigns] = await Promise.all([
    getSalesConfig(user.activeFirmId),
    canAssign ? listAssignableUsers(user.activeFirmId) : Promise.resolve([]),
    canCorrectAttribution
      ? prisma.campaign.findMany({ where: { firmId: user.activeFirmId }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  const closed = lead.stage === "WON" || lead.stage === "LOST";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const invoices = lead.quotations.flatMap((q) => q.convertedInvoices.map((inv) => ({ ...inv, quotationNumber: q.quotationNumber })));
  const wonValue = invoices.filter((i) => i.status !== "CANCELLED").reduce((sum, i) => sum + Number(i.totalAmount), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={lead.name}
        description={`${lead.leadNumber} · created ${formatDate(lead.createdAt)}${lead.createdBy ? ` by ${lead.createdBy.name}` : ""}`}
        backButton={
          <Button asChild variant="ghost" size="sm">
            <Link href="/leads"><ArrowLeft className="mr-2 h-4 w-4" /> Back to leads</Link>
          </Button>
        }
        actions={
          <>
            {canEdit ? (
              <EditLeadButton
                lead={{
                  id: lead.id,
                  name: lead.name,
                  phone: lead.phone,
                  email: lead.email,
                  location: lead.location,
                  requirements: lead.requirements,
                  productInterests: lead.productInterests,
                  estimatedBudget: lead.estimatedBudget ? Number(lead.estimatedBudget) : null,
                  remarks: lead.remarks,
                }}
              />
            ) : null}
            {canQuote && lead.stage !== "LOST" ? <CreateQuotationButton leadId={lead.id} /> : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={lead.stage} label={LEAD_STAGE_LABELS[lead.stage]} dot />
        {canEdit ? <StageControl leadId={lead.id} stage={lead.stage} lostReasons={config.lostReasons} /> : null}
        {lead.stage === "LOST" && lead.lostReason ? <span className="text-sm text-muted-foreground">Reason: {lead.lostReason}</span> : null}
        {lead.stage === "WON" && wonValue > 0 && canViewInvoices ? <span className="text-sm text-success">Invoiced {formatCurrency(wonValue)}</span> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Follow-ups</CardTitle></CardHeader>
            <CardContent>
              <FollowUpPanel
                leadId={lead.id}
                closed={closed || !canEdit}
                quotations={lead.quotations.map((q) => ({ id: q.id, quotationNumber: q.quotationNumber }))}
                followUps={lead.followUps.map((f) => ({
                  id: f.id,
                  dueAt: f.dueAt.toISOString(),
                  notes: f.notes,
                  completedAt: f.completedAt?.toISOString() ?? null,
                  overdue: f.dueAt < today,
                }))}
              />
            </CardContent>
          </Card>

          {canViewQuotations ? (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Quotations &amp; invoices</CardTitle></CardHeader>
            <CardContent className="px-0">
              {lead.quotations.length === 0 ? (
                <p className="px-4 pb-2 text-sm text-muted-foreground">No quotation yet{canQuote && lead.stage !== "LOST" ? " — use “Create quotation”." : "."}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Quotation</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="pr-4">Invoice</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lead.quotations.map((q) => (
                        <TableRow key={q.id}>
                          <TableCell className="pl-4">
                            {canViewQuotations ? (
                              <Link href={`/quotations/${q.id}`} className="font-medium text-primary hover:underline">{q.quotationNumber}</Link>
                            ) : (
                              q.quotationNumber
                            )}
                            <span className="ml-1 text-xs text-muted-foreground">r{q.revision}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <StatusBadge status={q.status} label={QUOTATION_STATUS_LABELS[q.status]} />
                              {q.reviewStatus === "PENDING" ? <StatusBadge status="PENDING" label={REVIEW_STATUS_LABELS.PENDING} /> : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-right numeric">{formatCurrency(q.totalAmount)}</TableCell>
                          <TableCell className="pr-4">
                            {q.convertedInvoices.length === 0 || !canViewInvoices
                              ? "—"
                              : q.convertedInvoices.map((inv) => (
                                  <div key={inv.id} className="text-sm">
                                    {canViewInvoices ? (
                                      <Link href={`/invoices/${inv.id}`} className="text-primary hover:underline">{inv.invoiceNumber}</Link>
                                    ) : (
                                      inv.invoiceNumber
                                    )}{" "}
                                    <span className="text-xs text-muted-foreground">
                                      {INVOICE_STATUS_LABELS[inv.status] ?? inv.status} · due {formatCurrency(inv.amountDue)}
                                    </span>
                                  </div>
                                ))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">History</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {canEdit ? <LogActivityForm leadId={lead.id} /> : null}
              <ol className="space-y-3 border-l border-border pl-4">
                {lead.activities.map((a) => (
                  <li key={a.id} className="relative text-sm">
                    <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{LEAD_ACTIVITY_LABELS[a.type]}</span>
                      {a.type === "STAGE_CHANGE" && a.fromStage ? (
                        <span className="text-muted-foreground">{LEAD_STAGE_LABELS[a.fromStage]} → {a.toStage ? LEAD_STAGE_LABELS[a.toStage] : ""}</span>
                      ) : null}
                      {a.outcome ? <span className="text-xs text-muted-foreground">· {a.outcome}</span> : null}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {formatDate(a.occurredAt)} · {a.createdBy?.name ?? "System"}
                      </span>
                    </p>
                    {a.notes ? <p className="whitespace-pre-wrap text-muted-foreground">{a.notes}</p> : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Contact</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="numeric font-medium">{lead.phone}</p>
              {lead.email ? <p className="text-muted-foreground">{lead.email}</p> : null}
              {lead.location ? <p className="text-muted-foreground">{lead.location}</p> : null}
              {lead.customer ? (
                <p className="pt-1">
                  Customer:{" "}
                  {user.permissions.includes("customers.view") ? (
                    <Link href={`/customers/${lead.customer.id}`} className="text-primary hover:underline">{lead.customer.name} ({lead.customer.code})</Link>
                  ) : (
                    lead.customer.name
                  )}
                  {user.permissions.includes("payments.view") && Number(lead.customer.outstandingAmount) > 0 ? (
                    <span className="block text-xs text-muted-foreground">Outstanding {formatCurrency(lead.customer.outstandingAmount)}</span>
                  ) : null}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Requirement</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {lead.requirements ? <p className="whitespace-pre-wrap">{lead.requirements}</p> : <p className="text-muted-foreground">Not recorded</p>}
              {lead.productInterests.length > 0 ? <p className="text-muted-foreground">Interested in: {lead.productInterests.join(", ")}</p> : null}
              {lead.estimatedBudget ? <p>Budget: <span className="numeric font-medium">{formatCurrency(lead.estimatedBudget)}</span></p> : null}
              {lead.remarks ? <p className="text-muted-foreground">Remarks: {lead.remarks}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Ownership &amp; attribution</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Owner</span>
                {canAssign ? (
                  <AssignControl leadId={lead.id} assigneeId={lead.assignedToId} owners={owners} />
                ) : (
                  <span>{lead.assignedTo?.name ?? "Unassigned"}</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Source</span>
                <span className="flex items-center gap-1">
                  {lead.source}
                  {canCorrectAttribution ? (
                    <AttributionButton leadId={lead.id} source={lead.source} campaignId={lead.campaignId} sources={config.leadSources} campaigns={campaigns} />
                  ) : null}
                </span>
              </div>
              {lead.sourceDetail ? <p className="text-muted-foreground">Referred by {lead.sourceDetail}</p> : null}
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Campaign</span>
                {lead.campaign ? (
                  user.permissions.includes("marketing.view") ? (
                    <Link href={`/marketing/campaigns/${lead.campaign.id}`} className="text-primary hover:underline">{lead.campaign.name}</Link>
                  ) : (
                    <span>{lead.campaign.name}</span>
                  )
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
