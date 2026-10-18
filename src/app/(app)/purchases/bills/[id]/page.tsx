import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WhatsAppShareButton } from "@/components/shared/whatsapp-share-button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PURCHASE_INVOICE_STATUS_LABELS } from "@/lib/workflow";
import { NotFoundError } from "@/lib/action-result";

export const metadata = { title: "Purchase Bill — Technic Technologies" };

export default async function PurchaseBillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionInFirm("purchase.view");
  const { id } = await params;

  const bill = await prisma.purchaseInvoice.findFirst({
    where: { id, firmId: user.activeFirmId, ...taxModeWhere(user) },
    include: {
      supplier: true,
      branch: true,
      lines: true,
      po: { select: { poNumber: true } },
      createdBy: { select: { name: true } },
    },
  });

  if (!bill) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={bill.invoiceNumber}
        description={`Purchase Bill · ${formatDate(bill.invoiceDate)}`}
        backButton={<Button asChild variant="ghost" size="sm"><Link href="/purchases/bills"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link></Button>}
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/documents/purchase-bill/${bill.id}`} target="_blank" rel="noreferrer">
                <FileDown /> PDF
              </a>
            </Button>
            <WhatsAppShareButton
              documentId={bill.id}
              documentType="purchase-bill"
              documentNumber={bill.invoiceNumber}
              customerPhone={bill.supplier.phone || undefined}
            />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={bill.status} label={PURCHASE_INVOICE_STATUS_LABELS[bill.status] ?? bill.status} dot />
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
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="pr-4 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bill.lines.map((line: any, index: number) => (
                    <TableRow key={line.id}>
                      <TableCell className="pl-4 numeric">{index + 1}</TableCell>
                      <TableCell>
                        <p className="font-medium">{line.description}</p>
                        {line.serialNumbers ? (
                          <p className="text-xs text-muted-foreground">SN: {line.serialNumbers.split("\n").join(", ")}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right numeric">{line.quantity}</TableCell>
                      <TableCell className="text-right numeric">{formatCurrency(line.unitPrice)}</TableCell>
                      <TableCell className="pr-4 text-right numeric font-medium">
                        {formatCurrency(line.lineTotal)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Separator className="my-4" />

            <div className="space-y-1.5 px-4 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="numeric">{formatCurrency(bill.subtotal)}</span></div>
              {Number(bill.discountAmount) > 0 ? (
                <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="numeric">-{formatCurrency(bill.discountAmount)}</span></div>
              ) : null}
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <span>Total</span><span className="numeric">{formatCurrency(bill.total)}</span>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="numeric">{formatCurrency(bill.amountPaid)}</span></div>
              <div className="flex justify-between font-medium"><span className="text-muted-foreground">Balance</span><span className="numeric">{formatCurrency(Math.max(0, Number(bill.total) - Number(bill.amountPaid)))}</span></div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Supplier</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{bill.supplier.name}</p>
              {bill.supplier.phone ? <p className="text-muted-foreground">{bill.supplier.phone}</p> : null}
              {bill.supplier.gstin ? <p className="text-muted-foreground">GSTIN: {bill.supplier.gstin}</p> : null}
              <p className="pt-1">
                <Link href={`/suppliers`} className="text-primary hover:underline">
                  View suppliers →
                </Link>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Bill Details</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>Branch: {bill.branch.name}</p>
              {bill.supplierRef ? <p>Supplier Ref: {bill.supplierRef}</p> : null}
              {bill.po ? <p>PO: {bill.po.poNumber}</p> : null}
              {bill.dueDate ? <p>Due: {formatDate(bill.dueDate)}</p> : null}
            </CardContent>
          </Card>

          {bill.notes ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Notes</CardTitle></CardHeader>
              <CardContent className="text-sm">{bill.notes}</CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
