import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { INVOICE_STATUS_LABELS } from "@/lib/workflow";
import { CUSTOMER_TYPE_LABELS } from "@/lib/workflow";

export const metadata = { title: "Customer — Technic Technologies" };

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermissionInFirm("customers.view");
  const { id } = await params;

  const customer = await prisma.customer.findFirst({
    where: { id, firmId: user.activeFirmId },
    include: {
      invoices: {
        orderBy: { invoiceDate: "desc" },
        take: 25,
        where: taxModeWhere(user),
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          totalAmount: true,
          amountDue: true,
          status: true,
          taxMode: true,
        },
      },
      _count: { select: { invoices: true, warranties: true, payments: true } },
    },
  });
  if (!customer) notFound();

  const outstanding = customer.invoices.reduce((sum, inv) => sum + Number(inv.amountDue), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={customer.name}
        description={`${CUSTOMER_TYPE_LABELS[customer.type] ?? customer.type} customer · code ${customer.code}`}
        backButton={<Button asChild variant="ghost" size="sm"><Link href="/customers"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link></Button>}
        actions={
          user.permissions.some((code) => code === "reports.view" || code === "payments.view") ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/ledgers/customer?party=${customer.id}`}>View ledger</Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Outstanding balance</CardTitle></CardHeader>
          <CardContent>
            <p className="numeric text-2xl font-semibold">{formatCurrency(customer.outstandingAmount ?? outstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Total purchases</CardTitle></CardHeader>
          <CardContent>
            <p className="numeric text-2xl font-semibold">{formatCurrency(customer.totalBilled)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Records</CardTitle></CardHeader>
          <CardContent className="pt-2 text-sm text-muted-foreground">
            {customer._count.invoices} invoices · {customer._count.payments} payments ·{" "}
            {customer._count.warranties} warranties
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent invoices</CardTitle></CardHeader>
          <CardContent className="px-0">
            {customer.invoices.length === 0 ? (
              <p className="px-4 text-sm text-muted-foreground">No purchases yet.</p>
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Invoice</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="pr-4 text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customer.invoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="pl-4">
                          <Link href={`/invoices/${invoice.id}`} className="font-medium text-primary hover:underline">
                            {invoice.invoiceNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="numeric">{formatDate(invoice.invoiceDate)}</TableCell>
                        <TableCell>
                          <StatusBadge
                            status={invoice.status}
                            label={INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}
                            dot
                          />
                        </TableCell>
                        <TableCell className="pr-4 text-right numeric font-medium">
                          {formatCurrency(invoice.totalAmount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Contact</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Phone</span>
              <span className="numeric font-medium">{customer.phone ?? "—"}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Email</span>
              <span className="truncate font-medium">{customer.email ?? "—"}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">GSTIN</span>
              <span className="font-mono text-xs">{customer.gstin ?? "—"}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Address</span>
              <span className="max-w-48 text-right">{customer.addressLine ?? "—"}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Credit limit</span>
              <span className="numeric font-medium">
                {Number(customer.creditLimit) > 0 ? formatCurrency(customer.creditLimit) : "No limit set"}
              </span>
            </div>
            <div className="flex justify-between pt-1">
              <span className="text-muted-foreground">Customer since</span>
              <span className="numeric">{formatDate(customer.createdAt)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
