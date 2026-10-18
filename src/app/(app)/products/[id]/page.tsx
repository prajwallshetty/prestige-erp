import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { EditProductButton } from "./edit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import { getStockByBranch } from "@/lib/services/inventory";
import { recentStockTransactions } from "@/lib/services/inventory-queries";
import { formatCurrency, formatNumber } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { SERIAL_STATUS_LABELS } from "@/lib/workflow";

export const metadata = { title: "Product — Technic Technologies" };

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionInFirm("products.view");
  const { id } = await params;

  const product = await prisma.product.findFirst({
    where: { id, firmId: user.activeFirmId },
    include: {
      brand: { select: { name: true } },
      category: { select: { name: true } },
      attributes: true,
      variants: { where: { isActive: true } },
    },
  });
  if (!product) notFound();

  const branchScope = user.branchId ?? (await prisma.branch.findFirst({ where: { firmId: user.activeFirmId } }))?.id ?? "";
  const [stockByBranch, serialUnits, transactions] = await Promise.all([
    getStockByBranch(user.activeFirmId, { productId: product.id }),
    product.trackSerials
      ? prisma.serialUnit.findMany({
          where: { firmId: user.activeFirmId, productId: product.id },
          orderBy: { createdAt: "desc" },
          take: 30,
          include: { branch: { select: { name: true } } },
        })
      : Promise.resolve([]),
    recentStockTransactions(user, { productId: product.id, take: 15 }),
  ]);

  const branches = await prisma.branch.findMany({
    where: { firmId: user.activeFirmId },
    select: { id: true, name: true },
  });
  const branchName = (branchId: string) => branches.find((b) => b.id === branchId)?.name ?? branchId;

  return (
    <div className="space-y-4">
      <PageHeader
        title={product.name}
        description={`${product.subName ? `${product.subName} · ` : ""}${product.sku}${product.brand ? ` · ${product.brand.name}` : ""}${product.category ? ` · ${product.category.name}` : ""}`}
        backButton={<Button asChild variant="ghost" size="sm"><Link href="/products"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link></Button>}
        actions={
          <>
            <StatusBadge
              status={product.status}
              label={product.status === "ACTIVE" ? "Active" : "Inactive"}
              tone={product.status === "ACTIVE" ? "success" : "neutral"}
            />
            {user.permissions.includes("products.edit") || user.permissions.includes("products.delete") ? (
              <EditProductButton
                canDelete={user.permissions.includes("products.delete")}
                product={{
                  id: product.id,
                  name: product.name,
                  subName: product.subName,
                  sku: product.sku,
                  barcode: product.barcode,
                  hsnCode: product.hsnCode,
                  gstRate: Number(product.gstRate),
                  purchasePrice: Number(product.purchasePrice),
                  sellingPrice: Number(product.sellingPrice),
                  mrp: Number(product.mrp),
                  warrantyMonths: product.warrantyMonths,
                  lowStockQty: product.lowStockQty,
                  trackSerials: product.trackSerials,
                  trackImei: product.trackImei,
                  description: product.description,
                  status: product.status,
                }}
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Pricing</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Selling price</span><span className="numeric font-medium">{formatCurrency(product.sellingPrice)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">MRP</span><span className="numeric">{formatCurrency(product.mrp)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Purchase price</span><span className="numeric">{formatCurrency(product.purchasePrice)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">GST rate</span><span className="numeric">{Number(product.gstRate)}%</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">HSN code</span><span>{product.hsnCode || "—"}</span></div>
            {product.warrantyMonths > 0 ? (
              <div className="flex justify-between"><span className="text-muted-foreground">Warranty</span><span>{product.warrantyMonths} months</span></div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Stock by branch</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {stockByBranch.size === 0 ? (
              <p className="text-muted-foreground">No stock recorded yet.</p>
            ) : (
              [...stockByBranch.entries()].map(([branchId, quantity]) => (
                <div key={branchId} className="flex justify-between">
                  <span className="text-muted-foreground">{branchName(branchId)}</span>
                  <span className="numeric font-medium">{formatNumber(quantity)}</span>
                </div>
              ))
            )}
            <p className="pt-1 text-xs text-muted-foreground">
              {product.trackSerials ? "Serial-tracked product" : "Quantity-tracked product"}
              {product.trackImei ? " · IMEI tracked" : ""}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Specifications</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {product.attributes.length === 0 ? (
              <p className="text-muted-foreground">No spec attributes recorded.</p>
            ) : (
              product.attributes.map((attribute) => (
                <div key={attribute.id} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{attribute.name}</span>
                  <span className="text-right font-medium">{attribute.value}</span>
                </div>
              ))
            )}
            {product.modelNumber ? (
              <div className="flex justify-between pt-1"><span className="text-muted-foreground">Model</span><span>{product.modelNumber}</span></div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {product.variants.length > 0 ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Variants</CardTitle></CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Variant</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right pr-4">Selling price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.variants.map((variant) => (
                  <TableRow key={variant.id}>
                    <TableCell className="pl-4 font-medium">{variant.name}</TableCell>
                    <TableCell className="font-mono text-xs">{variant.sku}</TableCell>
                    <TableCell className="pr-4 text-right numeric">{formatCurrency(variant.sellingPrice)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {product.trackSerials && serialUnits.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Serial units</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto scrollbar-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Serial</TableHead>
                    {product.trackImei ? <TableHead>IMEI</TableHead> : null}
                    <TableHead className="hidden sm:table-cell">Branch</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {serialUnits.map((unit) => (
                    <TableRow key={unit.id}>
                      <TableCell className="pl-4 font-mono text-xs">{unit.serialNumber}</TableCell>
                      {product.trackImei ? <TableCell className="font-mono text-xs">{unit.imei1 || "—"}</TableCell> : null}
                      <TableCell className="hidden sm:table-cell">{unit.branch.name}</TableCell>
                      <TableCell>
                        <StatusBadge status={unit.status} label={SERIAL_STATUS_LABELS[unit.status] ?? unit.status} dot />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="px-4 pt-3 text-xs text-muted-foreground">
              Full registry on the <Link href="/serials" className="text-primary hover:underline">Serial numbers</Link> page.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Recent stock movements</CardTitle></CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="hidden sm:table-cell">Reference</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="pr-4 text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="pl-4 text-muted-foreground">No movements yet.</TableCell></TableRow>
              ) : (
                transactions.map((txn) => (
                  <TableRow key={txn.id}>
                    <TableCell className="pl-4 numeric">{formatDate(txn.createdAt)}</TableCell>
                    <TableCell>{txn.type.replace(/_/g, " ").toLowerCase()}</TableCell>
                    <TableCell className="hidden sm:table-cell">{txn.reference || "—"}</TableCell>
                    <TableCell className={`text-right numeric ${txn.quantity < 0 ? "text-destructive" : "text-success"}`}>
                      {txn.quantity > 0 ? "+" : ""}{txn.quantity}
                    </TableCell>
                    <TableCell className="pr-4 text-right numeric">{txn.balanceAfter}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
