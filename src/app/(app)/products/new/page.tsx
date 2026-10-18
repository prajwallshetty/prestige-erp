"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProductAction } from "../actions";

interface Option {
  id: string;
  name: string;
}

const GST_RATES = ["0", "5", "12", "18", "28"];
const WARRANTY_TYPES = ["STANDARD", "EXTENDED", "MANUFACTURER", "SELLER"] as const;

export default function NewProductPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [categories, setCategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);

  const [name, setName] = useState("");
  const [subName, setSubName] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [hsnCode, setHsnCode] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [gstRate, setGstRate] = useState("18");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [mrp, setMrp] = useState("");
  const [warrantyMonths, setWarrantyMonths] = useState("");
  const [warrantyType, setWarrantyType] = useState<string>("STANDARD");
  const [lowStockQty, setLowStockQty] = useState("2");
  const [trackSerials, setTrackSerials] = useState(false);
  const [trackImei, setTrackImei] = useState(false);
  const [description, setDescription] = useState("");

  useEffect(() => {
    fetch("/api/products")
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .catch(() => ({ products: [] }));
    // categories & brands come from the products page's own query — fetch via
    // a small server round-trip is not available, so reuse the page data API.
  }, []);

  const submit = () => {
    startTransition(async () => {
      const result = await createProductAction({
        name,
        subName: subName.trim() || null,
        sku,
        barcode: barcode || null,
        hsnCode: hsnCode || null,
        categoryId: categoryId || null,
        brandId: brandId || null,
        gstRate: Number(gstRate),
        purchasePrice: Number(purchasePrice) || 0,
        sellingPrice: Number(sellingPrice) || 0,
        mrp: Number(mrp) || 0,
        warrantyMonths: Number(warrantyMonths) || 0,
        warrantyType: warrantyType as (typeof WARRANTY_TYPES)[number],
        lowStockQty: Number(lowStockQty) || 0,
        trackSerials,
        trackImei,
        description: description || null,
      });
      if (result.ok) {
        toast.success(`Product ${result.data.name} created`);
        router.push(`/products/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  const canSubmit = name.trim().length > 1 && sku.trim().length > 1 && !pending;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Add product"
        description="Create a catalogue item — prices include GST, matching shelf tags"
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Product name *</Label>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pressure Booster Pump" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-subname">Sub name / model</Label>
              <Input id="p-subname" value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="e.g. JJ 1HP Premium 24LTR Tank" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-sku">SKU *</Label>
              <Input id="p-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Unique stock code, e.g. MOB-SGS24-256" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-barcode">Barcode</Label>
              <Input id="p-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Scan or type the EAN/UPC" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-hsn">HSN code</Label>
              <Input id="p-hsn" value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} placeholder="e.g. 8517" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Purchase price (₹)</Label>
              <Input className="numeric" type="number" min="0" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="What you pay the supplier" />
            </div>
            <div className="space-y-1.5">
              <Label>Selling price (₹)</Label>
              <Input className="numeric" type="number" min="0" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} placeholder="Shelf price incl. GST" />
            </div>
            <div className="space-y-1.5">
              <Label>MRP (₹)</Label>
              <Input className="numeric" type="number" min="0" value={mrp} onChange={(e) => setMrp(e.target.value)} placeholder="Printed on the box" />
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
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Warranty (months)</Label>
              <Input className="numeric" type="number" min="0" value={warrantyMonths} onChange={(e) => setWarrantyMonths(e.target.value)} placeholder="0 = none" />
            </div>
            <div className="space-y-1.5">
              <Label>Warranty type</Label>
              <Select value={warrantyType} onValueChange={setWarrantyType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WARRANTY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.charAt(0) + type.slice(1).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Low-stock alert at</Label>
              <Input className="numeric" type="number" min="0" value={lowStockQty} onChange={(e) => setLowStockQty(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
            <label className="flex items-start justify-between gap-3 text-sm">
              <span>
                <span className="font-medium">Track serial numbers</span>
                <span className="block text-xs text-muted-foreground">Each unit gets its own serial — phones, laptops, TVs</span>
              </span>
              <input
                type="checkbox"
                className="mt-1 size-4 accent-[hsl(158_64%_22%)]"
                checked={trackSerials}
                onChange={(e) => setTrackSerials(e.target.checked)}
              />
            </label>
            <label className="flex items-start justify-between gap-3 text-sm">
              <span>
                <span className="font-medium">Track IMEI</span>
                <span className="block text-xs text-muted-foreground">For mobile phones — IMEI1 / IMEI2 recorded</span>
              </span>
              <input
                type="checkbox"
                className="mt-1 size-4 accent-[hsl(158_64%_22%)]"
                checked={trackImei}
                onChange={(e) => setTrackImei(e.target.checked)}
                disabled={!trackSerials}
              />
            </label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-desc">Description (optional)</Label>
            <textarea
              id="p-desc"
              className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything staff should know when selling this"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button onClick={submit} disabled={!canSubmit}>
          <PackagePlus /> {pending ? "Saving…" : "Create product"}
        </Button>
      </div>
    </div>
  );
}
