import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Purchase Return — Technic Technologies" };

export default async function PurchaseReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionInFirm("purchase.view");
  const { id } = await params;

  const purchaseReturn = await prisma.purchaseReturn.findFirst({
    where: { id, firmId: user.activeFirmId, ...taxModeWhere(user) },
    include: {
      supplier: true,
      branch: true,
      items: {
        include: {
          product: { select: { name: true, sku: true } },
        },
      },
      createdBy: { select: { name: true } },
    },
  });

  if (!purchaseReturn) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={purchaseReturn.returnNumber}
        description={`Purchase Return · ${formatDate(purchaseReturn.returnedAt)}`}
        backButton={<Button asChild variant="ghost" size="sm"><Link href="/purchases/returns"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link></Button>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Returned Items</CardTitle>
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
                  {purchaseReturn.items.map((line, index) => (
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
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <span>Total Return</span><span className="numeric">{formatCurrency(purchaseReturn.total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Supplier</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{purchaseReturn.supplier.name}</p>
              {purchaseReturn.supplier.phone ? <p className="text-muted-foreground">{purchaseReturn.supplier.phone}</p> : null}
              {purchaseReturn.supplier.gstin ? <p className="text-muted-foreground">GSTIN: {purchaseReturn.supplier.gstin}</p> : null}
              <p className="pt-1">
                <Link href={`/suppliers`} className="text-primary hover:underline">
                  View suppliers →
                </Link>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Return Details</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>Branch: {purchaseReturn.branch.name}</p>
              <p>Reason: {purchaseReturn.reason}</p>
              <p>Created by: {purchaseReturn.createdBy?.name || "—"}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
