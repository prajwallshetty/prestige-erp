import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WhatsAppShareButton } from "@/components/shared/whatsapp-share-button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PURCHASE_ORDER_STATUS_LABELS } from "@/lib/workflow";

export const metadata = { title: "Purchase Order — Technic Technologies" };

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionInFirm("purchase.view");
  const { id } = await params;

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, firmId: user.activeFirmId, ...taxModeWhere(user) },
    include: {
      supplier: true,
      branch: true,
      items: {
        include: {
          product: { select: { name: true, sku: true, hsnCode: true } },
        },
      },
      createdBy: { select: { name: true } },
    },
  });

  if (!po) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={po.poNumber}
        description={`Purchase Order · ${formatDate(po.orderDate)}`}
        backButton={<Button asChild variant="ghost" size="sm"><Link href="/purchases"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link></Button>}
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/documents/purchase-order/${po.id}`} target="_blank" rel="noreferrer">
                <FileDown /> PDF
              </a>
            </Button>
            <WhatsAppShareButton
              documentId={po.id}
              documentType="purchase-order"
              documentNumber={po.poNumber}
              customerPhone={po.supplier.phone || undefined}
            />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={po.status} label={PURCHASE_ORDER_STATUS_LABELS[po.status] ?? po.status} dot />
        {po.expectedDate ? (
          <span className="text-sm text-muted-foreground">Expected: {formatDate(po.expectedDate)}</span>
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
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="pr-4 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {po.items.map((item, index) => (
                    <TableRow key={item.id}>
                      <TableCell className="pl-4 numeric">{index + 1}</TableCell>
                      <TableCell>
                        <p className="font-medium">{item.description}</p>
                        <p className="text-xs text-muted-foreground">{item.product.sku}</p>
                      </TableCell>
                      <TableCell className="text-right numeric">{item.quantity}</TableCell>
                      <TableCell className="text-right numeric">{formatCurrency(item.unitPrice)}</TableCell>
                      <TableCell className="pr-4 text-right numeric font-medium">
                        {formatCurrency(item.lineTotal)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Separator className="my-4" />

            <div className="space-y-1.5 px-4 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="numeric">{formatCurrency(po.subtotal)}</span></div>
              {Number(po.discountAmount) > 0 ? (
                <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="numeric">-{formatCurrency(po.discountAmount)}</span></div>
              ) : null}
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <span>Total</span><span className="numeric">{formatCurrency(po.total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Supplier</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{po.supplier.name}</p>
              {po.supplier.phone ? <p className="text-muted-foreground">{po.supplier.phone}</p> : null}
              {po.supplier.gstin ? <p className="text-muted-foreground">GSTIN: {po.supplier.gstin}</p> : null}
              <p className="pt-1">
                <Link href={`/suppliers`} className="text-primary hover:underline">
                  View suppliers →
                </Link>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Details</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>Branch: {po.branch.name}</p>
              <p>Created by: {po.createdBy?.name || "—"}</p>
            </CardContent>
          </Card>

          {po.notes ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Notes</CardTitle></CardHeader>
              <CardContent className="text-sm">{po.notes}</CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
