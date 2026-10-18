"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus, Plus, Trash2, Truck, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Textarea } from "@/components/ui/textarea";
import {
  SearchableSelect,
  type SearchableOption,
} from "@/components/ui/searchable-select";
import { parseNumericInput, tidyAmountOnBlur, tidyQuantityOnBlur } from "@/lib/numeric-input";
import { QuickAddProductDialog, QuickAddSupplierDialog, type QuickProduct, type QuickSupplier } from "@/components/shared/quick-add";
import { receiveGoodsAction } from "./actions";

interface ProductOption {
  id: string;
  name: string;
  subName?: string | null;
  sku: string;
  purchasePrice: number;
  trackSerials: boolean;
}

interface SupplierOption {
  id: string;
  name: string;
}

interface Line {
  key: number;
  productId: string;
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  quantity: string;
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  unitPrice: string;
  serials: string;
}

let lineKey = 0;

export function NewPurchaseButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 0, productId: "", quantity: "1", unitPrice: "0", serials: "" }]);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [addSupplierOpen, setAddSupplierOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const loadOptions = async () => {
    if (suppliers.length > 0) return;
    const [suppliersRes, productsRes] = await Promise.all([
      fetch("/api/suppliers").then((r) => (r.ok ? r.json() : { suppliers: [] })),
      fetch("/api/products").then((r) => (r.ok ? r.json() : { products: [] })),
    ]);
    setSuppliers(suppliersRes.suppliers ?? []);
    setProducts(productsRes.products ?? []);
  };

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const supplierOptions: SearchableOption[] = suppliers.map((supplier) => ({
    value: supplier.id,
    label: supplier.name,
  }));
  const productOptions: SearchableOption[] = products.map((product) => ({
    value: product.id,
    label: product.subName ? `${product.name} — ${product.subName}` : product.name,
    hint: `${product.sku} · cost ₹${product.purchasePrice.toFixed(0)}`,
  }));

  const setLine = (key: number, updates: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...updates } : line)));

  const addLine = () =>
    setLines((current) => [...current, { key: (lineKey += 1), productId: "", quantity: "1", unitPrice: "0", serials: "" }]);

  const onProductCreated = (created: QuickProduct) => {
    setProducts((current) => [...current, { ...created }]);
    setLines((current) => {
      const target = current.find((line) => !line.productId);
      const filled = { productId: created.id, unitPrice: String(created.purchasePrice) };
      if (target) return current.map((line) => (line.key === target.key ? { ...line, ...filled } : line));
      return [...current, { key: (lineKey += 1), quantity: "1", serials: "", ...filled }];
    });
  };

  const onSupplierCreated = (created: QuickSupplier) => {
    setSuppliers((current) => [...current, { id: created.id, name: created.name }]);
    setSupplierId(created.id);
  };

  const submit = () => {
    startTransition(async () => {
      const result = await receiveGoodsAction({
        supplierId,
        supplierRef: supplierRef || null,
        paymentAmount: Number(paymentAmount) || undefined,
        lines: lines
          .filter((line) => line.productId)
          .map((line) => ({
            productId: line.productId,
            quantity: parseNumericInput(line.quantity),
            unitPrice: parseNumericInput(line.unitPrice),
            serialNumbers:
              productById.get(line.productId)?.trackSerials
                ? line.serials.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
                : undefined,
          })),
      });
      if (result.ok) {
        toast.success(`Goods received — bill ${result.data.invoiceNumber}`);
        setOpen(false);
        setLines([{ key: (lineKey += 1), productId: "", quantity: "1", unitPrice: "0", serials: "" }]);
        setPaymentAmount("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) void loadOptions(); }}>
      <DialogTrigger asChild>
        <Button variant="outline"><Truck /> Receive goods (no PO)</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record goods received</DialogTitle>
          <DialogDescription>
            Books the stock and the supplier bill now — serials are registered for tracked products.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Supplier *</Label>
              <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setAddSupplierOpen(true)}>
                <UserPlus className="size-3" /> Add supplier
              </Button>
            </div>
            <SearchableSelect
              ariaLabel="Supplier"
              options={supplierOptions}
              value={supplierId}
              onValueChange={setSupplierId}
              placeholder="Search supplier…"
              emptyMessage="No suppliers match"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sup-ref">Supplier bill no.</Label>
            <Input id="sup-ref" value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          {lines.map((line) => {
            const product = productById.get(line.productId);
            return (
              <div key={line.key} className="space-y-1.5 rounded-lg border border-border p-2.5">
                <div className="flex items-center gap-2">
                  <SearchableSelect
                    ariaLabel="Product"
                    className="flex-1"
                    options={productOptions}
                    value={line.productId}
                    onValueChange={(value) => {
                      const next = productById.get(value);
                      setLine(line.key, { productId: value, unitPrice: String(next?.purchasePrice ?? 0) });
                    }}
                    placeholder="Search product…"
                    emptyMessage="No products match"
                  />
                  <Input
                    className="w-20 numeric" type="number" min="1" value={line.quantity}
                    onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                    onBlur={(e) => setLine(line.key, { quantity: tidyQuantityOnBlur(e.target.value) })}
                    aria-label="Quantity"
                  />
                  <Input
                    className="w-28 numeric" type="number" min="0" step="0.01" value={line.unitPrice}
                    onChange={(e) => setLine(line.key, { unitPrice: e.target.value })}
                    onBlur={(e) => setLine(line.key, { unitPrice: tidyAmountOnBlur(e.target.value) })}
                    aria-label="Unit cost"
                  />
                  <Button size="icon-sm" variant="ghost" className="text-destructive"
                    onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))} aria-label="Remove">
                    <Trash2 />
                  </Button>
                </div>
                {product?.trackSerials ? (
                  <div>
                    <Label className="text-xs">Serial numbers ({line.quantity} needed)</Label>
                    <Textarea
                      className="mt-1 min-h-16 font-mono text-xs"
                      placeholder="One serial / IMEI per line"
                      value={line.serials}
                      onChange={(e) => setLine(line.key, { serials: e.target.value })}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={addLine}><Plus /> Add item</Button>
            <Button size="sm" variant="outline" onClick={() => setAddProductOpen(true)}><PackagePlus /> Add Product</Button>
          </div>
        </div>          <div className="space-y-1.5">
            <Label htmlFor="po-pay">Paid to supplier now (₹, optional)</Label>
            <Input id="po-pay" className="numeric w-40" type="number" min="0" value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)} />
          </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !supplierId || lines.every((l) => !l.productId)}>
            {pending ? "Saving…" : "Record receipt & bill"}
          </Button>
        </DialogFooter>
        <QuickAddProductDialog open={addProductOpen} onOpenChange={setAddProductOpen} onCreated={onProductCreated} />
        <QuickAddSupplierDialog open={addSupplierOpen} onOpenChange={setAddSupplierOpen} onCreated={onSupplierCreated} />
      </DialogContent>
    </Dialog>
  );
}
