import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WarrantySearch } from "./search";
import { requirePermissionInFirm } from "@/lib/session";
import { ShieldCheck } from "lucide-react";

export const metadata = { title: "Warranty — Technic Technologies" };

export default async function WarrantyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermissionInFirm("warranty.view");
  const params = await searchParams;
  const query = params.q?.trim();

  let result = null;
  if (query) {
    const { lookupWarranty } = await import("@/lib/services/products");
    try {
      result = await lookupWarranty(user.activeFirmId, query);
    } catch {
      result = null;
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Warranty"
        description="Look up any unit by serial number, IMEI or invoice number"
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Find a unit</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex max-w-md gap-2" action="/warranty">
            <Input name="q" defaultValue={query ?? ""} placeholder="Serial / IMEI / invoice #" />
            <Button type="submit">
              <ShieldCheck /> Look up
            </Button>
          </form>
        </CardContent>
      </Card>

      {query && !result ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No serial, IMEI or invoice matches “{query}”.
          </CardContent>
        </Card>
      ) : null}

      {result?.kind === "serial" && result.serialUnit ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Unit found</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p><span className="text-muted-foreground">Serial:</span> <span className="font-mono">{result.serialUnit.serialNumber}</span></p>
              {result.serialUnit.imei1 ? <p><span className="text-muted-foreground">IMEI:</span> <span className="font-mono">{result.serialUnit.imei1}</span></p> : null}
              <p><span className="text-muted-foreground">Product:</span> {result.serialUnit.product.name}</p>
              <p><span className="text-muted-foreground">Status:</span> <StatusBadge status={result.serialUnit.status} /></p>
            </div>
            {result.warranty ? (
              <div className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Warranty</span>
                  <StatusBadge status={result.warranty.status} dot />
                </div>
                <p className="mt-1 text-muted-foreground">
                  Valid {result.warranty.warrantyStart.toDateString().slice(4)} →{" "}
                  {result.warranty.warrantyEnd.toDateString().slice(4)} ·{" "}
                  {result.warranty.warrantyMonths} months ({result.warranty.warrantyType.toLowerCase()})
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No warranty record for this unit.</p>
            )}
            <WarrantySearch
              warrantyId={result.warranty?.id ?? null}
              canClaim={Boolean(result.warranty) && user.permissions.includes("warranty.claim")}
            />
          </CardContent>
        </Card>
      ) : null}

      {result?.kind === "invoice" ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Invoice warranties</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {result.warranties.length === 0 ? (
              <p className="text-sm text-muted-foreground">No warranty records on this invoice.</p>
            ) : (
              result.warranties.map((warranty) => (
                <div key={warranty.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{warranty.product.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{warranty.serialUnit?.serialNumber ?? warranty.serialNumber ?? "—"}</p>
                  </div>
                  <StatusBadge status={warranty.status} dot />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
