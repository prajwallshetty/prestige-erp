import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getQuotationForView } from "@/lib/services/sales";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";
import { quotationScopeWhere } from "@/lib/sales-scope";
import { getSalesConfig } from "@/lib/services/sales-config";
import { discountNeedsApproval, REVIEW_STATUS_LABELS } from "@/lib/sales-config";
import { prisma } from "@/lib/prisma";
import { QuotationReviewActions, QuotationShare } from "./quotation-workflow";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { QUOTATION_STATUS_LABELS } from "@/lib/workflow";
import { NotFoundError } from "@/lib/action-result";

import { isPlatformRole } from "@/lib/rbac";
import { EditQuotationButton } from "../edit-quotation-button";
import { DeleteQuotationButton } from "../delete-quotation-button";

export const metadata = { title: "Quotation — Technic Technologies" };

export default async function QuotationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermissionInFirm("quotation.view");
  const { id } = await params;
  const sParams = searchParams ? await searchParams : {};

  let quotation;
  try {
    quotation = await getQuotationForView(user.activeFirmId, id, {
      ...taxModeWhere(user),
      scope: quotationScopeWhere(user),
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  if (quotation.firmId !== user.activeFirmId) notFound();

  const [config, revisions, salespeople] = await Promise.all([
    getSalesConfig(user.activeFirmId),
    prisma.quotationRevision.findMany({
      where: { quotationId: quotation.id },
      orderBy: { revision: "desc" },
      select: { id: true, revision: true, changeNote: true, totalAmount: true, createdAt: true, changedBy: { select: { name: true } } },
    }),
    user.permissions.includes("leads.assign")
      ? prisma.user.findMany({
          where: { firmId: user.activeFirmId, status: "ACTIVE", role: { in: ["SALES_STAFF", "MANAGER", "ADMIN"] } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const discountPct = Number(quotation.discountPercentEffective);
  const overLimit = discountNeedsApproval(discountPct, config.maxStaffDiscountPercent);
  const canReview = user.permissions.includes("quotation.review");
  const canSubmitReview = user.permissions.includes("quotation.create") || user.permissions.includes("quotation.edit");
  const shareBlocked =
    overLimit && quotation.reviewStatus !== "APPROVED"
      ? `Discount ${discountPct}% exceeds the ${config.maxStaffDiscountPercent}% limit — manager approval required before sending`
      : ["REJECTED", "EXPIRED"].includes(quotation.status)
        ? `A ${quotation.status.toLowerCase()} quotation cannot be sent`
        : null;
  const isGst = quotation.taxMode === "GST";
  const hasLineDiscount = Number(quotation.discountAmount) > 0 || quotation.lines.some((l) => Number(l.discountPercent) > 0);
  const canConvert = quotation.status !== "CONVERTED" && user.permissions.includes("quotation.convert");
  const canEdit =
    quotation.status !== "CONVERTED" &&
    (user.permissions.includes("quotation.create") ||
      user.permissions.includes("sales.edit") ||
      user.permissions.includes("quotation.edit"));
  const canDelete =
    quotation.status !== "CONVERTED" &&
    (user.permissions.includes("quotation.delete") ||
      user.permissions.includes("sales.edit") ||
      user.permissions.includes("quotation.edit"));
  const canSwitchMode = isPlatformRole(user.role);

  return (
    <div className="space-y-4">
      <PageHeader
        title={quotation.quotationNumber}
        description={`Quotation · ${formatDate(quotation.quotationDate)}`}
        backButton={<Button asChild variant="ghost" size="sm"><Link href="/quotations"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link></Button>}
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/documents/quotation/${quotation.id}`} target="_blank" rel="noreferrer">
                <FileDown /> PDF
              </a>
            </Button>
            {quotation.status !== "CONVERTED" ? (
              <QuotationShare
                quotationId={quotation.id}
                quotationNumber={quotation.quotationNumber}
                customerPhone={quotation.customer.phone}
                customerEmail={quotation.customer.email}
                disabled={Boolean(shareBlocked)}
              />
            ) : null}
            {canEdit ? (
              <EditQuotationButton
                quotation={quotation}
                salespeople={salespeople}
                canSwitchMode={canSwitchMode}
                defaultOpen={sParams.edit === "true"}
              />
            ) : null}
            {canDelete ? (
              <DeleteQuotationButton
                quotationId={quotation.id}
                quotationNumber={quotation.quotationNumber}
                redirectOnDelete
              />
            ) : null}
            {canConvert ? (
              <Button asChild>
                <Link href={`/quotations/${quotation.id}/convert`}>Convert to Invoice</Link>
              </Button>
            ) : null}
          </>
        }
      />

      {shareBlocked && quotation.status !== "CONVERTED" ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm" role="status">
          {shareBlocked}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={quotation.status} label={QUOTATION_STATUS_LABELS[quotation.status] ?? quotation.status} dot />
        <StatusBadge
          status={quotation.taxMode}
          label={quotation.taxMode === "GST" ? "GST mode" : "Non-Tax"}
          tone={quotation.taxMode === "GST" ? "info" : "neutral"}
        />
        {quotation.reviewStatus !== "NONE" ? (
          <StatusBadge
            status={quotation.reviewStatus}
            label={REVIEW_STATUS_LABELS[quotation.reviewStatus]}
            tone={quotation.reviewStatus === "APPROVED" ? "success" : quotation.reviewStatus === "PENDING" ? "warning" : "danger"}
          />
        ) : null}
        <span className="text-sm text-muted-foreground">Revision {quotation.revision}</span>
        {quotation.validUntil ? (
          <span className="text-sm text-muted-foreground">Valid until: {formatDate(quotation.validUntil)}</span>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Items</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto scrollbar-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">#</TableHead>
                    <TableHead>Item</TableHead>
                    {isGst ? <TableHead className="hidden sm:table-cell">HSN</TableHead> : null}
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    {hasLineDiscount ? <TableHead className="text-right">Disc %</TableHead> : null}
                    {isGst ? <TableHead className="hidden text-right sm:table-cell">Taxable</TableHead> : null}
                    {isGst ? <TableHead className="hidden text-right sm:table-cell">GST</TableHead> : null}
                    <TableHead className="pr-4 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotation.lines.map((line, index) => {
                    const gross = Math.round((line.quantity * Number(line.unitPrice) + Number.EPSILON) * 100) / 100;
                    const discPct = Number(line.discountPercent || 0);
                    const discAmount = Math.round(((gross * discPct) / 100 + Number.EPSILON) * 100) / 100;
                    const netGross = Math.round((gross - discAmount + Number.EPSILON) * 100) / 100;
                    const gstRate = Number(line.gstRate || 0);
                    const taxableValue = isGst && gstRate > 0
                      ? Math.round((netGross / (1 + gstRate / 100) + Number.EPSILON) * 100) / 100
                      : netGross;
                    const gstAmount = Math.round((netGross - taxableValue + Number.EPSILON) * 100) / 100;

                    return (
                      <TableRow key={line.id}>
                        <TableCell className="pl-4 numeric">{index + 1}</TableCell>
                        <TableCell>
                          <p className="font-medium">{line.description}</p>
                          {line.product?.subName ? <p className="text-xs text-muted-foreground">{line.product.subName}</p> : null}
                          {line.serialNumbers && (Array.isArray(line.serialNumbers) ? line.serialNumbers.length > 0 : String(line.serialNumbers).trim()) ? (
                            <p className="text-xs text-muted-foreground">SN: {Array.isArray(line.serialNumbers) ? line.serialNumbers.join(", ") : line.serialNumbers}</p>
                          ) : null}
                        </TableCell>
                        {isGst ? (
                          <TableCell className="hidden numeric sm:table-cell">{line.hsnCode || "—"}</TableCell>
                        ) : null}
                        <TableCell className="text-right numeric">{line.quantity}</TableCell>
                        <TableCell className="text-right numeric">{formatCurrency(line.unitPrice)}</TableCell>
                        {hasLineDiscount ? (
                          <TableCell className="text-right numeric">
                            {discPct > 0 ? `${discPct}%` : "—"}
                          </TableCell>
                        ) : null}
                        {isGst ? (
                          <TableCell className="hidden text-right numeric sm:table-cell">
                            {formatCurrency(taxableValue)}
                          </TableCell>
                        ) : null}
                        {isGst ? (
                          <TableCell className="hidden text-right numeric sm:table-cell">
                            {formatCurrency(gstAmount)}
                          </TableCell>
                        ) : null}
                        <TableCell className="pr-4 text-right numeric font-medium">
                          {formatCurrency(line.lineTotal)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <Separator className="my-4" />

            <div className="space-y-1.5 px-4 text-sm font-medium">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items subtotal</span>
                <span className="numeric">{formatCurrency(quotation.subtotal)}</span>
              </div>
              {Number(quotation.discountAmount) > 0 ? (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <div>
                    <span>
                      Bill discount (
                      {(() => {
                        const sub = Number(quotation.subtotal);
                        const disc = Number(quotation.discountAmount);
                        if (sub > 0) {
                          const pct = (disc / sub) * 100;
                          if (Math.abs(pct - Math.round(pct)) < 0.01) {
                            return `${Math.round(pct)}%`;
                          }
                        }
                        return "flat";
                      })()}
                      )
                    </span>
                    {quotation.discountRemarks ? (
                      <span className="ml-2 text-xs text-muted-foreground font-normal">
                        ({quotation.discountRemarks})
                      </span>
                    ) : null}
                  </div>
                  <span className="numeric">-{formatCurrency(quotation.discountAmount)}</span>
                </div>
              ) : null}
              {isGst ? (
                <>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Taxable value</span>
                    <span className="numeric">{formatCurrency(quotation.taxableAmount)}</span>
                  </div>
                  {Number(quotation.cgstAmount) > 0 ? (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>CGST</span>
                      <span className="numeric">{formatCurrency(quotation.cgstAmount)}</span>
                    </div>
                  ) : null}
                  {Number(quotation.sgstAmount) > 0 ? (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>SGST</span>
                      <span className="numeric">{formatCurrency(quotation.sgstAmount)}</span>
                    </div>
                  ) : null}
                  {Number(quotation.igstAmount) > 0 ? (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>IGST</span>
                      <span className="numeric">{formatCurrency(quotation.igstAmount)}</span>
                    </div>
                  ) : null}
                </>
              ) : null}
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Round off</span>
                <span className="numeric">
                  {Number(quotation.roundOff) === 0
                    ? "0.00"
                    : Number(quotation.roundOff) > 0
                    ? `+${formatCurrency(quotation.roundOff)}`
                    : formatCurrency(quotation.roundOff)}
                </span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <span>Quotation total</span>
                <span className="numeric">{formatCurrency(quotation.totalAmount)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Quotation For</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{quotation.customer.name}</p>
              {quotation.customer.phone ? <p className="text-muted-foreground">{quotation.customer.phone}</p> : null}
              {quotation.customer.gstin ? <p className="text-muted-foreground">GSTIN: {quotation.customer.gstin}</p> : null}
              <p className="pt-1">
                <Link href={`/customers/${quotation.customerId}`} className="text-primary hover:underline">
                  View customer →
                </Link>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Details</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>Branch: {quotation.branch.name}</p>
              <p>Created by: {quotation.createdBy?.name || "—"} · {formatDate(quotation.createdAt)}</p>
              <p>Salesperson: {quotation.assignedTo?.name || "—"}</p>
              <p>Last modified: {formatDate(quotation.updatedAt)}</p>
              {discountPct > 0 ? <p>Effective discount: {discountPct}%</p> : null}
              {quotation.sharedAt ? <p>Sent {formatDate(quotation.sharedAt)} via {quotation.sharedVia}</p> : null}
              {quotation.lead ? (
                <p>
                  Lead:{" "}
                  <Link href={`/leads/${quotation.lead.id}`} className="text-primary hover:underline">
                    {quotation.lead.leadNumber} · {quotation.lead.name}
                  </Link>
                  {quotation.lead.campaign ? (
                    <>
                      {" "}· <Link href={`/marketing/campaigns/${quotation.lead.campaign.id}`} className="text-primary hover:underline">{quotation.lead.campaign.name}</Link>
                    </>
                  ) : (
                    <> · {quotation.lead.source}</>
                  )}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {quotation.convertedInvoices.length > 0 ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Invoice</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {quotation.convertedInvoices.map((invoice) => (
                  <div key={invoice.id} className="flex items-center justify-between gap-2">
                    <Link href={`/invoices/${invoice.id}`} className="font-medium text-primary hover:underline">
                      {invoice.invoiceNumber}
                    </Link>
                    <span className="numeric text-muted-foreground">
                      {formatCurrency(invoice.totalAmount)} · due {formatCurrency(invoice.amountDue)}
                    </span>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Converted {quotation.convertedAt ? formatDate(quotation.convertedAt) : ""}
                  {quotation.convertedBy ? ` by ${quotation.convertedBy.name}` : ""}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {quotation.status !== "CONVERTED" && (canReview || canSubmitReview) ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Manager review</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  {REVIEW_STATUS_LABELS[quotation.reviewStatus]}
                  {quotation.reviewedBy ? ` · ${quotation.reviewedBy.name}` : ""}
                  {quotation.reviewedAt ? ` · ${formatDate(quotation.reviewedAt)}` : ""}
                </p>
                {quotation.reviewNotes ? (
                  <p className="rounded-md bg-muted px-2.5 py-2">{quotation.reviewNotes}</p>
                ) : null}
                {overLimit && quotation.reviewStatus !== "APPROVED" ? (
                  <p className="text-xs text-warning-foreground">
                    Discount {discountPct}% is above the {config.maxStaffDiscountPercent}% limit and needs approval.
                  </p>
                ) : null}
                <QuotationReviewActions
                  quotationId={quotation.id}
                  reviewStatus={quotation.reviewStatus}
                  canSubmit={canSubmitReview}
                  canReview={canReview}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Revisions</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {revisions.map((revision) => (
                <div key={revision.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">r{revision.revision}{revision.revision === quotation.revision ? " (current)" : ""}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {revision.changeNote || "Edited"} · {revision.changedBy?.name ?? "—"} · {formatDate(revision.createdAt)}
                    </p>
                  </div>
                  <span className="numeric shrink-0 text-muted-foreground">{formatCurrency(revision.totalAmount)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {quotation.notes ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Notes</CardTitle></CardHeader>
              <CardContent className="text-sm">{quotation.notes}</CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
