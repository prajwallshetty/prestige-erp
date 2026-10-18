"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateInvoiceDispatchAction } from "./actions";

interface Dispatch {
  dispatchThrough: string;
  vehicleNumber: string;
  ewayBillNumber: string;
  buyerOrderNo: string;
}

/** Dispatch / e-way details printed in the invoice PDF header. */
export function DispatchDetailsButton({ invoiceId, initial }: { invoiceId: string; initial: Dispatch }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initial);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof Dispatch) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));

  const submit = () => {
    startTransition(async () => {
      const result = await updateInvoiceDispatchAction({ invoiceId, ...form });
      if (result.ok) {
        toast.success("Dispatch details saved");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Truck /> Dispatch details</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dispatch &amp; e-way details</DialogTitle>
          <DialogDescription>Printed in the invoice PDF header. All fields are optional.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="dd-through">Dispatched through</Label>
            <Input id="dd-through" value={form.dispatchThrough} onChange={set("dispatchThrough")} placeholder="Own vehicle / transporter" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dd-vehicle">Vehicle number</Label>
            <Input id="dd-vehicle" className="uppercase" value={form.vehicleNumber} onChange={set("vehicleNumber")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dd-eway">E-way bill number</Label>
            <Input id="dd-eway" value={form.ewayBillNumber} onChange={set("ewayBillNumber")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dd-order">Buyer&apos;s order no.</Label>
            <Input id="dd-order" value={form.buyerOrderNo} onChange={set("buyerOrderNo")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
