"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { createProductAction } from "@/app/(app)/products/actions";
import { createCustomerAction } from "@/app/(app)/customers/actions";
import { createSupplierAction } from "@/app/(app)/suppliers/actions";

/**
 * "Create master data without leaving the page" dialogs. Each one is
 * controlled by its parent, lives *inside* the transaction screen (a nested
 * dialog), and hands the saved record back through `onCreated` so the caller
 * can select it — the surrounding form state is never touched or reset.
 */

const GST_RATES = ["0", "5", "12", "18", "28"];
const STATES = [
  "Andhra Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi", "Goa", "Gujarat",
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala",
  "Madhya Pradesh", "Maharashtra", "Odisha", "Punjab", "Rajasthan", "Tamil Nadu",
  "Telangana", "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

export interface QuickProduct {
  id: string;
  name: string;
  subName: string | null;
  sku: string;
  hsnCode: string | null;
  gstRate: number;
  purchasePrice: number;
  sellingPrice: number;
  trackSerials: boolean;
}

export interface QuickCustomer {
  id: string;
  name: string;
  phone: string;
  gstin: string | null;
  state: string | null;
  code: string;
}

export interface QuickSupplier {
  id: string;
  name: string;
  code: string;
}

interface DialogProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (record: T) => void;
  /** Pre-fill the name, e.g. with whatever the user had typed in the search box. */
  initialName?: string;
}

function generateSku(): string {
  return `PRD-${Date.now().toString(36).toUpperCase()}`;
}

export function QuickAddProductDialog({ open, onOpenChange, onCreated, initialName }: DialogProps<QuickProduct>) {
  const blank = { name: "", subName: "", sku: "", hsnCode: "", gstRate: "18", purchasePrice: "", sellingPrice: "" };
  const [form, setForm] = useState(blank);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof blank) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = () => {
    startTransition(async () => {
      const result = await createProductAction({
        name: form.name,
        subName: form.subName.trim() || null,
        sku: form.sku.trim() || generateSku(),
        hsnCode: form.hsnCode.trim() || null,
        gstRate: Number(form.gstRate),
        purchasePrice: Number(form.purchasePrice) || 0,
        sellingPrice: Number(form.sellingPrice) || 0,
      });
      if (result.ok) {
        toast.success(`Product ${result.data.name} created`);
        onCreated(result.data);
        setForm(blank);
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && initialName && !form.name) setForm((c) => ({ ...c, name: initialName }));
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add product</DialogTitle>
          <DialogDescription>Saved straight into your product master and selected here.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="qp-name">Product name *</Label>
            <Input id="qp-name" value={form.name} onChange={set("name")} placeholder="e.g. Pressure Booster Pump" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="qp-sub">Sub name / model</Label>
            <Input id="qp-sub" value={form.subName} onChange={set("subName")} placeholder="e.g. JJ 1HP Premium 24LTR Tank" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qp-sku">SKU (auto if blank)</Label>
            <Input id="qp-sku" value={form.sku} onChange={set("sku")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qp-hsn">HSN code</Label>
            <Input id="qp-hsn" value={form.hsnCode} onChange={set("hsnCode")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qp-pp">Purchase price (₹)</Label>
            <Input id="qp-pp" className="numeric" type="number" min="0" value={form.purchasePrice} onChange={set("purchasePrice")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qp-sp">Selling price (₹)</Label>
            <Input id="qp-sp" className="numeric" type="number" min="0" value={form.sellingPrice} onChange={set("sellingPrice")} />
          </div>
          <div className="space-y-1.5">
            <Label>GST rate</Label>
            <Select value={form.gstRate} onValueChange={(v) => setForm((c) => ({ ...c, gstRate: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {GST_RATES.map((rate) => <SelectItem key={rate} value={rate}>{rate}%</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || form.name.trim().length < 2}>
            {pending ? "Saving…" : "Save product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function QuickAddCustomerDialog({ open, onOpenChange, onCreated, initialName }: DialogProps<QuickCustomer>) {
  const blank = { name: "", phone: "", gstin: "", city: "", state: "Karnataka" };
  const [form, setForm] = useState(blank);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof blank) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = () => {
    startTransition(async () => {
      const result = await createCustomerAction({
        name: form.name,
        phone: form.phone,
        gstin: form.gstin.trim() || null,
        city: form.city.trim() || null,
        state: form.state,
      });
      if (result.ok) {
        toast.success(`Customer ${result.data.name} created`);
        onCreated(result.data);
        setForm(blank);
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && initialName && !form.name) setForm((c) => ({ ...c, name: initialName }));
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add customer</DialogTitle>
          <DialogDescription>Saved to your customer master and selected here.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="qc-name">Name *</Label>
            <Input id="qc-name" value={form.name} onChange={set("name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qc-phone">Phone *</Label>
            <Input id="qc-phone" className="numeric" value={form.phone} onChange={set("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qc-gstin">GSTIN</Label>
            <Input id="qc-gstin" className="uppercase" value={form.gstin} onChange={set("gstin")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qc-city">City</Label>
            <Input id="qc-city" value={form.city} onChange={set("city")} />
          </div>
          <div className="space-y-1.5">
            <Label>State</Label>
            <Select value={form.state} onValueChange={(v) => setForm((c) => ({ ...c, state: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATES.map((state) => <SelectItem key={state} value={state}>{state}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !form.name.trim() || !form.phone.trim()}>
            {pending ? "Saving…" : "Save customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function QuickAddSupplierDialog({ open, onOpenChange, onCreated, initialName }: DialogProps<QuickSupplier>) {
  const blank = { name: "", phone: "", gstin: "", city: "", state: "Karnataka" };
  const [form, setForm] = useState(blank);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof blank) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = () => {
    startTransition(async () => {
      const result = await createSupplierAction({
        name: form.name,
        phone: form.phone.trim() || null,
        gstin: form.gstin.trim() || null,
        city: form.city.trim() || null,
        state: form.state,
      });
      if (result.ok) {
        toast.success(`Supplier ${result.data.name} created`);
        onCreated(result.data);
        setForm(blank);
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && initialName && !form.name) setForm((c) => ({ ...c, name: initialName }));
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add supplier</DialogTitle>
          <DialogDescription>Saved to your supplier master and selected here.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="qs-name">Name *</Label>
            <Input id="qs-name" value={form.name} onChange={set("name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qs-phone">Phone</Label>
            <Input id="qs-phone" className="numeric" value={form.phone} onChange={set("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qs-gstin">GSTIN</Label>
            <Input id="qs-gstin" className="uppercase" value={form.gstin} onChange={set("gstin")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qs-city">City</Label>
            <Input id="qs-city" value={form.city} onChange={set("city")} />
          </div>
          <div className="space-y-1.5">
            <Label>State</Label>
            <Select value={form.state} onValueChange={(v) => setForm((c) => ({ ...c, state: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATES.map((state) => <SelectItem key={state} value={state}>{state}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !form.name.trim()}>
            {pending ? "Saving…" : "Save supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
