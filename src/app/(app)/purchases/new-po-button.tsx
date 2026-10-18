"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus, Plus, ShoppingCart, Trash2, UserPlus } from "lucide-react";
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
import { formatCurrency } from "@/lib/money";
import { parseNumericInput, tidyAmountOnBlur, tidyQuantityOnBlur } from "@/lib/numeric-input";
import { QuickAddProductDialog, QuickAddSupplierDialog, type QuickProduct, type QuickSupplier } from "@/components/shared/quick-add";
import { createPurchaseOrderAction } from "./po-actions";

interface SupplierOption {
  id: string;
  name: string;
  phone?: string | null;
}

interface ProductOption {
  id: string;
  name: string;
  subName?: string | null;
  sku: string;
  purchasePrice: number;
}

interface Line {
  key: number;
  productId: string;
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  quantity: string;
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  unitPrice: string;
}

let lineKey = 0;

export function NewPurchaseOrderButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 0, productId: "", quantity: "1", unitPrice: "0" }]);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [addSupplierOpen, setAddSupplierOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const loadOptions = async () => {
    if (loaded) return;
    const [suppliersRes, productsRes] = await Promise.all([
      fetch("/api/suppliers").then((r) => (r.ok ? r.json() : { suppliers: [] })),
      fetch("/api/products").then((r) => (r.ok ? r.json() : { products: [] })),
    ]);
    setSuppliers(suppliersRes.suppliers ?? []);
    setProducts(productsRes.products ?? []);
    setLoaded(true);
  };

  const productById = new Map(products.map((p) => [p.id, p]));

  const supplierOptions: SearchableOption[] = suppliers.map((supplier) => ({
    value: supplier.id,
    label: supplier.name,
    hint: supplier.phone ?? undefined,
  }));
  const productOptions: SearchableOption[] = products.map((product) => ({
    value: product.id,
    label: product.subName ? `${product.name} — ${product.subName}` : product.name,
    hint: `${product.sku} · cost ${formatCurrency(product.purchasePrice)}`,
  }));

  const setLine = (key: number, updates: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...updates } : line)));

  const addLine = () =>
    setLines((current) => [...current, { key: (lineKey += 1), productId: "", quantity: "1", unitPrice: "0" }]);

  const onProductCreated = (created: QuickProduct) => {
    setProducts((current) => [...current, { ...created }]);
    setLines((current) => {
      const target = current.find((line) => !line.productId);
      const filled = { productId: created.id, unitPrice: String(created.purchasePrice) };
      if (target) return current.map((line) => (line.key === target.key ? { ...line, ...filled } : line));
      return [...current, { key: (lineKey += 1), quantity: "1", ...filled }];
    });
  };

  const onSupplierCreated = (created: QuickSupplier) => {
    setSuppliers((current) => [...current, { id: created.id, name: created.name }]);
    setSupplierId(created.id);
  };

  const submit = () => {
    startTransition(async () => {
      const result = await createPurchaseOrderAction({
        supplierId,
        expectedDate: expectedDate || null,
        notes: notes || null,
        lines: lines
          .filter((line) => line.productId)
          .map((line) => ({
            productId: line.productId,
            quantity: parseNumericInput(line.quantity),
            unitPrice: parseNumericInput(line.unitPrice),
          })),
      });
      if (result.ok) {
        toast.success(`Purchase order ${result.data.poNumber} created`);
        setOpen(false);
        setLines([{ key: (lineKey += 1), productId: "", quantity: "1", unitPrice: "0" }]);
        setSupplierId("");
        setExpectedDate("");
        setNotes("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const validLines = lines.filter((line) => line.productId);
  const total = validLines.reduce(
    (sum, line) => sum + parseNumericInput(line.quantity) * parseNumericInput(line.unitPrice),
    0,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadOptions();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> New purchase order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
          <DialogDescription>
            Tell the supplier what to deliver — receiving the goods later books the bill and stock.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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

          <div className="space-y-2">
            <Label>Items *</Label>
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
                        const product = productById.get(value);
                        setLine(line.key, {
                          productId: value,
                          unitPrice: String(product?.purchasePrice ?? 0),
                        });
                      }}
                      placeholder="Search product…"
                      emptyMessage="No products match"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                      aria-label="Remove line"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-24">
                      <Label className="text-xs text-muted-foreground">Quantity</Label>
                      <Input
                        className="numeric h-8"
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                        onBlur={(e) => setLine(line.key, { quantity: tidyQuantityOnBlur(e.target.value) })}
                        aria-label="Quantity"
                      />
                    </div>
                    <div className="w-32">
                      <Label className="text-xs text-muted-foreground">Cost (₹)</Label>
                      <Input
                        className="numeric h-8"
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) => setLine(line.key, { unitPrice: e.target.value })}
                        onBlur={(e) => setLine(line.key, { unitPrice: tidyAmountOnBlur(e.target.value) })}
                        aria-label="Unit cost"
                      />
                    </div>
                    <span className="numeric ml-auto pt-5 text-sm font-semibold">
                      {formatCurrency(parseNumericInput(line.quantity) * parseNumericInput(line.unitPrice))}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus /> Add item
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAddProductOpen(true)}>
                <PackagePlus /> Add Product
              </Button>
            </div>
          </div>

          {validLines.length > 0 ? (
            <div className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm font-medium">
              <span>Order total</span>
              <span className="numeric">{formatCurrency(total)}</span>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="po-expected">Expected by (optional)</Label>
              <Input
                id="po-expected"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="po-notes">Notes (optional)</Label>
              <Input
                id="po-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Delivery or packing instructions…"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !supplierId || validLines.length === 0}>
            <ShoppingCart /> {pending ? "Saving…" : "Create order"}
          </Button>
        </DialogFooter>
        <QuickAddProductDialog open={addProductOpen} onOpenChange={setAddProductOpen} onCreated={onProductCreated} />
        <QuickAddSupplierDialog open={addSupplierOpen} onOpenChange={setAddSupplierOpen} onCreated={onSupplierCreated} />
      </DialogContent>
    </Dialog>
  );
}
