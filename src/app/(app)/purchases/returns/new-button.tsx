"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { createPurchaseReturnAction } from "./return-actions";

interface SupplierOption {
  id: string;
  name: string;
}

interface BillOption {
  id: string;
  invoiceNumber: string;
  supplierId: string;
}

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  purchasePrice: number;
  trackSerials: boolean;
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

export function NewPurchaseReturnButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [bills, setBills] = useState<BillOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [billId, setBillId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 0, productId: "", quantity: "1", unitPrice: "0", serials: "" }]);
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

  const loadBills = async (supplierId: string) => {
    const billsRes = await fetch(`/api/suppliers/${supplierId}/bills`);
    if (billsRes.ok) {
      const data = await billsRes.json();
      setBills(data.bills ?? []);
    }
  };

  const productById = new Map(products.map((p) => [p.id, p]));

  const supplierOptions: SearchableOption[] = suppliers.map((supplier) => ({
    value: supplier.id,
    label: supplier.name,
  }));

  const billOptions: SearchableOption[] = bills.map((bill) => ({
    value: bill.id,
    label: bill.invoiceNumber,
  }));

  const productOptions: SearchableOption[] = products.map((product) => ({
    value: product.id,
    label: product.name,
    hint: `${product.sku} · cost ${formatCurrency(product.purchasePrice)}`,
  }));

  const setLine = (key: number, updates: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...updates } : line)));

  const addLine = () =>
    setLines((current) => [...current, { key: (lineKey += 1), productId: "", quantity: "1", unitPrice: "0", serials: "" }]);

  const submit = () => {
    startTransition(async () => {
      const result = await createPurchaseReturnAction({
        supplierId,
        purchaseInvoiceId: billId || null,
        reason: reason || null,
        lines: lines
          .filter((line) => line.productId)
          .map((line) => ({
            productId: line.productId,
            quantity: parseNumericInput(line.quantity),
            unitPrice: parseNumericInput(line.unitPrice),
            serialNumbers: productById.get(line.productId)?.trackSerials
              ? line.serials.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
              : undefined,
          })),
      });
      if (result.ok) {
        toast.success(`Purchase return ${result.data.returnNumber} created`);
        setOpen(false);
        setLines([{ key: (lineKey += 1), productId: "", quantity: "1", unitPrice: "0", serials: "" }]);
        setReason("");
        setBillId("");
        setSupplierId("");
        setBills([]);
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
          <Undo2 /> New purchase return
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New purchase return</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Supplier *</Label>
            <SearchableSelect
              ariaLabel="Supplier"
              options={supplierOptions}
              value={supplierId}
              onValueChange={(value) => {
                setSupplierId(value);
                setBillId("");
                loadBills(value);
              }}
              placeholder="Search supplier…"
              emptyMessage="No suppliers match"
            />
          </div>
          {supplierId && (
            <div className="space-y-1.5">
              <Label>Bill (optional)</Label>
              <SearchableSelect
                ariaLabel="Bill"
                options={billOptions}
                value={billId}
                onValueChange={setBillId}
                placeholder="Select a bill or leave blank"
                emptyMessage="No bills found"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="return-reason">Reason *</Label>
            <Textarea
              id="return-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are these goods being returned?"
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
            <Button size="sm" variant="outline" onClick={addLine}>
              <Undo2 /> Add item
            </Button>
          </div>

          {validLines.length > 0 ? (
            <div className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm font-medium">
              <span>Return total</span>
              <span className="numeric">{formatCurrency(total)}</span>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !supplierId || !reason || validLines.length === 0}>
            {pending ? "Saving…" : "Create return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
