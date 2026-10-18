import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WhatsAppShareButton } from "@/components/shared/whatsapp-share-button";
import { getPaymentForView } from "@/lib/services/payments";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PAYMENT_DIRECTION_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/workflow";
import { NotFoundError } from "@/lib/action-result";

export const metadata = { title: "Payment — Technic Technologies" };

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionInFirm("payments.view");
  const { id } = await params;

  let payment;
  try {
    payment = await getPaymentForView(user.activeFirmId, id, { ...taxModeWhere(user) });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  if (payment.firmId !== user.activeFirmId) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={payment.paymentNumber}
        description={`Payment · ${formatDate(payment.paidAt)}`}
        backButton={<Button asChild variant="ghost" size="sm"><Link href="/payments"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link></Button>}
        actions={
          <>
            {payment.direction === "CUSTOMER_IN" ? (
              <Button asChild variant="outline">
                <a href={`/api/documents/receipt/${payment.id}`} target="_blank" rel="noreferrer">
                  <FileDown /> PDF
                </a>
              </Button>
            ) : null}
            {payment.direction === "CUSTOMER_IN" ? (
              <WhatsAppShareButton
                documentId={payment.id}
                documentType="receipt"
                documentNumber={payment.paymentNumber}
                customerPhone={payment.customer?.phone}
              />
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={payment.direction === "CUSTOMER_IN" ? "success" : payment.direction === "REFUND_OUT" ? "warning" : "neutral"}>
          {PAYMENT_DIRECTION_LABELS[payment.direction] ?? payment.direction}
        </Badge>
        <Badge>{PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}</Badge>
        {payment.isAdvance ? <Badge tone="info">Advance</Badge> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Payment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Amount</p>
                <p className="text-2xl font-semibold">{formatCurrency(payment.amount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Method</p>
                <p className="font-medium">{PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Date</p>
                <p className="font-medium">{formatDate(payment.paidAt)}</p>
              </div>
              {payment.reference ? (
                <div>
                  <p className="text-muted-foreground">Reference</p>
                  <p className="font-medium">{payment.reference}</p>
                </div>
              ) : null}
            </div>

            {payment.notes ? (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Notes</p>
                <p className="text-sm">{payment.notes}</p>
              </div>
            ) : null}

            {payment.invoice ? (
              <div className="border-t border-border pt-4">
                <p className="text-sm text-muted-foreground mb-2">Linked Invoice</p>
                <Link href={`/invoices/${payment.invoice.id}`} className="block">
                  <div className="rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors">
                    <p className="font-medium">{payment.invoice.invoiceNumber}</p>
                    <p className="text-sm text-muted-foreground">{payment.invoice.customer?.name}</p>
                    <p className="text-sm text-muted-foreground">{formatDate(payment.invoice.invoiceDate)}</p>
                  </div>
                </Link>
              </div>
            ) : payment.isAdvance ? (
              <div className="border-t border-border pt-4">
                <p className="text-sm text-muted-foreground">Advance Payment</p>
                <p className="text-sm">This is an advance payment from the customer.</p>
              </div>
            ) : null}

            {payment.salesReturn ? (
              <div className="border-t border-border pt-4">
                <p className="text-sm text-muted-foreground mb-2">Refund For</p>
                <div className="rounded-lg border border-border p-3">
                  <p className="font-medium">Sales Return</p>
                  <p className="text-sm text-muted-foreground">{payment.salesReturn.invoice?.invoiceNumber}</p>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Customer</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{payment.customer?.name || "—"}</p>
              {payment.customer?.phone ? <p className="text-muted-foreground">{payment.customer.phone}</p> : null}
              {payment.customer?.gstin ? <p className="text-muted-foreground">GSTIN: {payment.customer.gstin}</p> : null}
              {payment.customerId ? (
                <p className="pt-1">
                  <Link href={`/customers/${payment.customerId}`} className="text-primary hover:underline">
                    View customer →
                  </Link>
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Branch</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>{payment.branch.name}</p>
              <p>Received by: {payment.receivedBy?.name || "—"}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
