import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermissionInFirm } from "@/lib/session";
import { getSegment, getSegmentOptions } from "@/lib/services/segments";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { CUSTOMER_TYPE_LABELS } from "@/lib/workflow";

export const metadata = { title: "Customer segments — Technic Technologies" };

export default async function SegmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermissionInFirm("marketing.view");
  const params = await searchParams;
  // Aggregates are marketing analytics; the customer list itself needs customers.view.
  const canListCustomers = user.permissions.includes("customers.view");

  const [segment, options] = await Promise.all([
    getSegment(user, params, { includeCustomers: canListCustomers }),
    getSegmentOptions(user),
  ]);
  const filtered = Boolean(params.q || params.city || params.type || params.recency || params.minBilled || params.categoryId || params.interest);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customer segments"
        description="Slice the existing customer base by location, type, purchase history and interests"
        backButton={<Button asChild variant="ghost" size="sm"><Link href="/marketing"><ArrowLeft className="mr-2 h-4 w-4" /> Marketing</Link></Button>}
      />
      <FilterBar
        searchPlaceholder="Search name or company…"
        filters={[
          { name: "city", label: "City", options: options.cities.map((c) => ({ value: c, label: c })) },
          { name: "type", label: "Customer type", options: Object.entries(CUSTOMER_TYPE_LABELS).map(([value, label]) => ({ value, label })) },
          {
            name: "recency",
            label: "Purchase history",
            options: [
              { value: "active", label: "Bought in last 90 days" },
              { value: "lapsed", label: "No purchase for 180+ days" },
              { value: "never", label: "Never invoiced" },
            ],
          },
          {
            name: "minBilled",
            label: "Lifetime billing",
            options: [
              { value: "50000", label: "₹50,000+" },
              { value: "100000", label: "₹1,00,000+" },
              { value: "500000", label: "₹5,00,000+" },
            ],
          },
          { name: "categoryId", label: "Bought category", options: options.categories.map((c) => ({ value: c.id, label: c.name })) },
          { name: "interest", label: "Lead interest", options: options.interests.map((i) => ({ value: i, label: i })) },
        ]}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={filtered ? "Customers in segment" : "Active customers"} value={segment.count} />
        <StatCard label="Lifetime billing" value={formatCurrency(segment.totalBilled)} animate={false} />
        <StatCard label="Outstanding" value={formatCurrency(segment.outstanding)} animate={false} tone={segment.outstanding > 0 ? "warning" : "default"} />
        <StatCard label="Avg. per customer" value={segment.count ? formatCurrency(segment.totalBilled / segment.count) : "—"} animate={false} />
      </div>

      {!canListCustomers ? (
        <p className="text-sm text-muted-foreground">Your role sees segment totals only. Customer names and contact details need the customers permission.</p>
      ) : segment.customers.length === 0 ? (
        <EmptyState title="No customers in this segment" description={filtered ? "Loosen a filter to widen the segment." : "Customers appear here once they are created."} />
      ) : (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Top {segment.customers.length} by lifetime billing</CardTitle></CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Customer</TableHead>
                    <TableHead className="hidden sm:table-cell">City</TableHead>
                    <TableHead className="hidden sm:table-cell">Type</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Invoices</TableHead>
                    <TableHead className="pr-4">Last purchase</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {segment.customers.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="pl-4"><Link href={`/customers/${c.id}`} className="font-medium text-primary hover:underline">{c.name}</Link><span className="ml-2 text-xs text-muted-foreground">{c.phone}</span></TableCell>
                      <TableCell className="hidden sm:table-cell">{c.city ?? "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell"><Badge tone="outline">{CUSTOMER_TYPE_LABELS[c.type] ?? c.type}</Badge></TableCell>
                      <TableCell className="text-right numeric">{formatCurrency(c.totalBilled)}</TableCell>
                      <TableCell className="hidden text-right numeric md:table-cell">{c.invoiceCount}</TableCell>
                      <TableCell className="pr-4 numeric">{c.lastInvoiceAt ? formatDate(c.lastInvoiceAt) : "Never"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
