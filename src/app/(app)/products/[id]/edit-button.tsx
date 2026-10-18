"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Pencil } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseNumericInput } from "@/lib/numeric-input";
import { updateProductAction, toggleProductStatusAction } from "../actions";

const GST_RATES = ["0", "5", "12", "18", "28"];

export function EditProductButton({
  product,
  canDelete,
}: {
  product: {
    id: string;
    name: string;
    subName?: string | null;
    sku: string;
    barcode: string | null;
    hsnCode: string | null;
    gstRate: number;
    purchasePrice: number;
    sellingPrice: number;
    mrp: number;
    warrantyMonths: number;
    lowStockQty: number;
    trackSerials: boolean;
    trackImei: boolean;
    description: string | null;
    status: string;
  };
  canDelete: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(product.name);
  const [subName, setSubName] = useState(product.subName ?? "");
  const [sku, setSku] = useState(product.sku);
  const [barcode, setBarcode] = useState(product.barcode ?? "");
  const [hsnCode, setHsnCode] = useState(product.hsnCode ?? "");
  const [gstRate, setGstRate] = useState(String(Number(product.gstRate)));
  const [purchasePrice, setPurchasePrice] = useState(String(Number(product.purchasePrice)));
  const [sellingPrice, setSellingPrice] = useState(String(Number(product.sellingPrice)));
  const [mrp, setMrp] = useState(String(Number(product.mrp)));
  const [warrantyMonths, setWarrantyMonths] = useState(String(product.warrantyMonths));
  const [lowStockQty, setLowStockQty] = useState(String(product.lowStockQty));

  const submit = () => {
    startTransition(async () => {
      const result = await updateProductAction({
        id: product.id,
        name,
        subName: subName.trim() || null,
        sku,
        barcode: barcode || null,
        hsnCode: hsnCode || null,
        gstRate: Number(gstRate),
        purchasePrice: parseNumericInput(purchasePrice),
        sellingPrice: parseNumericInput(sellingPrice),
        mrp: parseNumericInput(mrp),
        warrantyMonths: Number(warrantyMonths) || 0,
        lowStockQty: Number(lowStockQty) || 0,
        trackSerials: product.trackSerials,
        trackImei: product.trackImei,
        description: product.description,
      });
      if (result.ok) {
        toast.success("Product updated");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const deactivate = () => {
    if (!window.confirm(`Deactivate "${product.name}"? It will no longer be selectable when billing or receiving stock, but its history stays intact.`)) {
      return;
    }
    startTransition(async () => {
      const result = await toggleProductStatusAction({ id: product.id, active: false });
      if (result.ok) {
        toast.success("Product deactivated");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const reactivate = () => {
    startTransition(async () => {
      const result = await toggleProductStatusAction({ id: product.id, active: true });
      if (result.ok) {
        toast.success("Product reactivated");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <>
      {product.status !== "ACTIVE" ? (
        <Button variant="outline" onClick={reactivate} disabled={pending}>
          <Archive /> Reactivate
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <Pencil /> Edit
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit product</DialogTitle>
            <DialogDescription>
              Changes apply to future billing and receipts — past documents keep their original numbers.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ep-name">Product name *</Label>
              <Input id="ep-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-subname">Sub name / model</Label>
              <Input id="ep-subname" value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="e.g. JJ 1HP Premium 24LTR Tank" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-sku">SKU *</Label>
              <Input id="ep-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-barcode">Barcode</Label>
              <Input id="ep-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-hsn">HSN code</Label>
              <Input id="ep-hsn" value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-pp">Purchase price (₹)</Label>
              <Input
                id="ep-pp"
                className="numeric"
                type="number"
                min="0"
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-sp">Selling price (₹)</Label>
              <Input
                id="ep-sp"
                className="numeric"
                type="number"
                min="0"
                step="0.01"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-mrp">MRP (₹)</Label>
              <Input
                id="ep-mrp"
                className="numeric"
                type="number"
                min="0"
                step="0.01"
                value={mrp}
                onChange={(e) => setMrp(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>GST rate</Label>
              <Select value={gstRate} onValueChange={setGstRate}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GST_RATES.map((rate) => (
                    <SelectItem key={rate} value={rate}>{rate}%</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-warranty">Warranty (months)</Label>
              <Input
                id="ep-warranty"
                className="numeric"
                type="number"
                min="0"
                value={warrantyMonths}
                onChange={(e) => setWarrantyMonths(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-low">Low-stock alert at</Label>
              <Input
                id="ep-low"
                className="numeric"
                type="number"
                min="0"
                value={lowStockQty}
                onChange={(e) => setLowStockQty(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button onClick={submit} disabled={pending || !name.trim() || !sku.trim()}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canDelete && product.status === "ACTIVE" ? (
        <Button variant="outline" className="text-destructive" onClick={deactivate} disabled={pending}>
          <Archive /> Deactivate
        </Button>
      ) : null}
    </>
  );
}
