import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WhatsAppShareButton } from "@/components/shared/whatsapp-share-button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/workflow";

export const metadata = { title: "Expense — Technic Technologies" };

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionInFirm("expenses.view");
  const { id } = await params;

  const expense = await prisma.expense.findFirst({
    where: { id, firmId: user.activeFirmId },
    include: {
      branch: true,
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
    },
  });

  if (!expense) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={expense.expenseNumber}
        description={`Expense · ${formatDate(expense.expenseDate)}`}
        backButton={<Button asChild variant="ghost" size="sm"><Link href="/expenses"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link></Button>}
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/documents/expense/${expense.id}`} target="_blank" rel="noreferrer">
                <FileDown /> PDF
              </a>
            </Button>
            <WhatsAppShareButton
              documentId={expense.id}
              documentType="expense"
              documentNumber={expense.expenseNumber}
            />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="outline">{EXPENSE_CATEGORY_LABELS[expense.category] ?? expense.category}</Badge>
        <Badge>{expense.status}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Expense Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Amount</p>
                <p className="text-2xl font-semibold">{formatCurrency(expense.amount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Payment Method</p>
                <p className="font-medium">{expense.paymentMethod}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Date</p>
                <p className="font-medium">{formatDate(expense.expenseDate)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Paid To</p>
                <p className="font-medium">{expense.paidTo || "—"}</p>
              </div>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-1">Description</p>
              <p className="text-sm">{expense.description}</p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Branch</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>{expense.branch.name}</p>
              <p>Created by: {expense.createdBy?.name || "—"}</p>
              {expense.approvedBy ? <p>Approved by: {expense.approvedBy.name}</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
