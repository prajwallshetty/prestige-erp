"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createJournalEntryAction } from "../actions";

type JType = "DEBIT_ADJUSTMENT" | "CREDIT_ADJUSTMENT" | "DISCOUNT_ALLOWED" | "DISCOUNT_RECEIVED";

const TYPE_LABEL: Record<JType, string> = {
  DEBIT_ADJUSTMENT: "Debit adjustment",
  CREDIT_ADJUSTMENT: "Credit adjustment / credit note",
  DISCOUNT_ALLOWED: "Discount allowed (customer)",
  DISCOUNT_RECEIVED: "Discount received (supplier)",
};

export function JournalEntryDialog({
  customers,
  suppliers,
  defaultCustomerId,
  defaultSupplierId,
}: {
  customers: SearchableOption[];
  suppliers: SearchableOption[];
  defaultCustomerId?: string;
  defaultSupplierId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<JType>("DEBIT_ADJUSTMENT");
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const [supplierId, setSupplierId] = useState(defaultSupplierId ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");

  const customerSide = type === "DISCOUNT_ALLOWED";
  const supplierSide = type === "DISCOUNT_RECEIVED";

  const submit = () => {
    startTransition(async () => {
      const result = await createJournalEntryAction({
        type,
        customerId: supplierSide ? null : customerId || null,
        supplierId: customerSide ? null : supplierId || null,
        amount: Number(amount),
        entryDate: date,
        narration,
      });
      if (result.ok) {
        toast.success(`Entry ${result.data.entryNumber} posted`);
        setOpen(false);
        setAmount("");
        setNarration("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus /> Add adjustment</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add adjustment / discount</DialogTitle>
          <DialogDescription>
            Posts a journal entry that flows into the party ledger, outstanding and reports.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as JType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_LABEL) as JType[]).map((t) => (
                  <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!supplierSide ? (
            <div className="space-y-1.5">
              <Label>Customer{customerSide ? " *" : " (optional)"}</Label>
              <SearchableSelect ariaLabel="Customer" options={customers} value={customerId}
                onValueChange={(v) => { setCustomerId(v); if (v) setSupplierId(""); }} placeholder="Select customer…" />
            </div>
          ) : null}
          {!customerSide ? (
            <div className="space-y-1.5">
              <Label>Supplier{supplierSide ? " *" : " (optional)"}</Label>
              <SearchableSelect ariaLabel="Supplier" options={suppliers} value={supplierId}
                onValueChange={(v) => { setSupplierId(v); if (v) setCustomerId(""); }} placeholder="Select supplier…" />
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="je-amt">Amount (₹) *</Label>
              <Input id="je-amt" className="numeric" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="je-date">Date</Label>
              <Input id="je-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="je-narr">Narration *</Label>
            <Input id="je-narr" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Reason for the entry" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !(Number(amount) > 0) || !narration.trim()
            || (customerSide && !customerId) || (supplierSide && !supplierId)}>
            {pending ? "Posting…" : "Post entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
