import Link from "next/link";
import { Package, User, Receipt, Truck, FileText, Barcode } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { globalSearch } from "@/lib/services/search";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";

export const metadata = { title: "Search — Technic Technologies" };

const ICONS = {
  product: Package,
  serial: Barcode,
  customer: User,
  invoice: Receipt,
  supplier: Truck,
  quotation: FileText,
} as const;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermissionInFirm("dashboard.view");
  const params = await searchParams;
  const query = params.q?.trim() ?? "";

  const hits =
    query.length >= 2
      ? await globalSearch(user.activeFirmId, query, 30, taxModeWhere(user))
      : [];

  return (
    <div className="space-y-4">
      <PageHeader title="Search" description={query ? `Results for “${query}”` : "Search products, serials, invoices, customers"} />

      <form className="flex max-w-md gap-2" action="/search">
        <Input name="q" defaultValue={query} placeholder="Search…" aria-label="Search" />
        <Button type="submit" variant="outline">Search</Button>
      </form>

      {query && hits.length === 0 ? (
        <EmptyState title={`No matches for “${query}”`} description="Try a product name, SKU, barcode, serial/IMEI, invoice number or phone." />
      ) : null}

      <div className="space-y-2">
        {hits.map((hit) => {
          const Icon = ICONS[hit.kind];
          return (
            <Link key={`${hit.kind}-${hit.id}`} href={hit.href}>
              <Card className="lift py-0 transition-colors hover:border-primary/40">
                <CardContent className="flex items-center gap-3 p-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className="size-4 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{hit.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{hit.subtitle}</p>
                  </div>
                  <Badge tone="outline">{hit.kind}</Badge>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
