"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
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
import { createSupplierAction } from "./actions";

export function AddSupplierButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", gstin: "", city: "", state: "Karnataka" });
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = () => {
    startTransition(async () => {
      const result = await createSupplierAction({
        name: form.name,
        phone: form.phone || null,
        gstin: form.gstin || null,
        city: form.city || null,
        state: form.state,
      });
      if (result.ok) {
        toast.success(`Supplier ${result.data.code} created`);
        setOpen(false);
        setForm({ name: "", phone: "", gstin: "", city: "", state: "Karnataka" });
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Truck /> Add supplier</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New supplier</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sup-name">Name *</Label>
            <Input id="sup-name" value={form.name} onChange={set("name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sup-phone">Phone</Label>
            <Input id="sup-phone" className="numeric" value={form.phone} onChange={set("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sup-gstin">GSTIN</Label>
            <Input id="sup-gstin" className="font-mono uppercase" value={form.gstin} onChange={set("gstin")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sup-city">City</Label>
            <Input id="sup-city" value={form.city} onChange={set("city")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sup-state">State</Label>
            <Input id="sup-state" value={form.state} onChange={set("state")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !form.name.trim()}>
            {pending ? "Saving…" : "Create supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
