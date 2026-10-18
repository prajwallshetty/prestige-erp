"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Wrench } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAdjustmentAction } from "./actions";

const TYPES = [
  { value: "INCREASE", label: "Increase" },
  { value: "DECREASE", label: "Decrease" },
  { value: "DAMAGE", label: "Damage" },
  { value: "LOST", label: "Lost" },
  { value: "CORRECTION", label: "Correction (set exact count)" },
];

export function NewAdjustmentButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<{ id: string; name: string; sku: string }[]>([]);
  const [productId, setProductId] = useState("");
  const [type, setType] = useState("INCREASE");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const loadProducts = () => {
    if (products.length > 0) return;
    fetch("/api/products")
      .then((response) => (response.ok ? response.json() : { products: [] }))
      .then((data) => setProducts(data.products ?? []))
      .catch(() => setProducts([]));
  };

  const submit = () => {
    startTransition(async () => {
      const result = await createAdjustmentAction({
        productId,
        type: type as never,
        quantity: Number(quantity),
        reason,
      });
      if (result.ok) {
        toast.success(`Adjustment ${result.data.adjustmentNumber} recorded`);
        setOpen(false);
        setReason("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) loadProducts(); }}>
      <DialogTrigger asChild>
        <Button><Wrench /> New adjustment</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New stock adjustment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Product *</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>{product.name} ({product.sku})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-qty">Quantity *</Label>
              <Input id="adj-qty" className="numeric" type="number" min="1" value={quantity}
                onChange={(event) => setQuantity(event.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adj-reason">Reason *</Label>
            <Textarea id="adj-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !productId || !(Number(quantity) > 0) || reason.trim().length < 3}>
            <Plus /> {pending ? "Saving…" : "Record adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
