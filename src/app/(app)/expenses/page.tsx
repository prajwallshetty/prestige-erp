import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { AddExpenseButton } from "./add-button";
import { listExpenses, getMonthlyExpenseSummary } from "@/lib/services/expenses";
import { requirePermissionInFirm, resolveBranchScope } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/workflow";

export const metadata = { title: "Expenses — Technic Technologies" };

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermissionInFirm("expenses.view");
  const params = await searchParams;
  const scope = resolveBranchScope(user, null);

  const [rows, summary] = await Promise.all([
    listExpenses({
      firmId: user.activeFirmId,
      branchId: scope.branchId,
      search: params.q,
      category: params.category && params.category !== "all" ? (params.category as never) : undefined,
    }),
    getMonthlyExpenseSummary(user.activeFirmId, scope.branchId),
  ]);

  const canApprove = user.permissions.includes("expenses.approve");

  const columns: Column<(typeof rows)[number]>[] = [
    { key: "number", header: "Voucher #", cell: (row) => <Link href={`/expenses/${row.id}`} className="font-medium hover:text-primary hover:underline">{row.expenseNumber}</Link> },
    { key: "description", header: "Description", cell: (row) => <span className="line-clamp-1">{row.description}</span> },
    { key: "category", header: "Category", hideOnMobile: true, cell: (row) => <Badge tone="outline">{EXPENSE_CATEGORY_LABELS[row.category] ?? row.category}</Badge> },
    { key: "paidTo", header: "Paid to", hideOnMobile: true, cell: (row) => row.paidTo ?? "—" },
    { key: "date", header: "Date", hideOnMobile: true, cell: (row) => <span className="numeric">{formatDate(row.expenseDate)}</span> },
    { key: "amount", header: "Amount", headerClassName: "text-right", className: "text-right numeric font-medium", cell: (row) => formatCurrency(row.amount) },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} dot /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Expenses"
        description="Operating expenses with approval workflow"
        actions={user.permissions.includes("expenses.create") ? <AddExpenseButton /> : null}
      />

      <StatCard label="This month" value={formatCurrency(summary.currentMonthTotal)} />

      <FilterBar
        searchPlaceholder="Voucher, description…"
        filters={[
          {
            name: "category",
            label: "Category",
            options: Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        renderMobileCard={(row) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.expenseNumber}</span>
              <span className="numeric font-semibold">{formatCurrency(row.amount)}</span>
            </div>
            <p className="line-clamp-1 text-sm text-muted-foreground">{row.description}</p>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{formatDate(row.expenseDate)}</span>
              <StatusBadge status={row.status} />
            </div>
            {canApprove && row.status === "PENDING" ? <ApproveInline expenseId={row.id} /> : null}
          </div>
        )}
      />
    </div>
  );
}

function ApproveInline({ expenseId }: { expenseId: string }) {
  return (
    <form action={async () => {
      "use server";
      const { authorize } = await import("@/lib/session");
      const { approveExpense } = await import("@/lib/services/payments");
      const { revalidatePath } = await import("next/cache");
      const user = await authorize("expenses.approve");
      await approveExpense(user.activeFirmId!, expenseId, "APPROVED", user.id);
      revalidatePath("/expenses");
    }}>
      <button type="submit" className="text-xs text-primary hover:underline">Approve</button>
    </form>
  );
}
