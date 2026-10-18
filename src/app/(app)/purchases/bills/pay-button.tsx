"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { recordSupplierPaymentAction } from "./pay-actions";

interface SupplierOption {
  id: string;
  name: string;
  phone?: string | null;
}

interface BillOption {
  id: string;
  invoiceNumber: string;
  total: number;
  amountPaid: number;
}

export function PaySupplierButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [bills, setBills] = useState<BillOption[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [billId, setBillId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [pending, startTransition] = useTransition();

  const loadSuppliers = () => {
    if (suppliers.length > 0) return;
    fetch("/api/suppliers")
      .then((response) => (response.ok ? response.json() : { suppliers: [] }))
      .then((data) => setSuppliers(data.suppliers ?? []))
      .catch(() => setSuppliers([]));
  };

  const loadBills = (supplierId: string) => {
    fetch(`/api/suppliers/${supplierId}/bills`)
      .then((response) => (response.ok ? response.json() : { bills: [] }))
      .then((data) => setBills(data.bills ?? []))
      .catch(() => setBills([]));
  };

  const supplierOptions: SearchableOption[] = suppliers.map((supplier) => ({
    value: supplier.id,
    label: supplier.name,
    hint: supplier.phone ?? undefined,
  }));

  const billOptions: SearchableOption[] = bills
    .filter((bill) => bill.total > bill.amountPaid)
    .map((bill) => ({
      value: bill.id,
      label: bill.invoiceNumber,
      hint: `Balance: ₹${(bill.total - bill.amountPaid).toFixed(2)}`,
    }));

  const submit = () => {
    startTransition(async () => {
      const result = await recordSupplierPaymentAction({
        supplierId,
        invoiceId: billId || null,
        amount: Number(amount),
        method: method as never,
        reference: reference || null,
      });
      if (result.ok) {
        toast.success(`Payment ${result.data.paymentNumber} recorded`);
        setOpen(false);
        setAmount("");
        setReference("");
        setBillId("");
        setSupplierId("");
        setBills([]);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) loadSuppliers();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Wallet /> Pay supplier
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record supplier payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pay-supplier">Supplier</Label>
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
              <Label htmlFor="pay-bill">Bill (optional)</Label>
              <SearchableSelect
                ariaLabel="Bill"
                options={billOptions}
                value={billId}
                onValueChange={setBillId}
                placeholder="Select a bill or leave blank for on-account payment"
                emptyMessage="No unpaid bills"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount (₹)</Label>
            <Input
              id="pay-amount"
              className="numeric"
              type="number"
              min="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-method">Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="pay-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE", "OTHER"].map((option) => (
                  <SelectItem key={option} value={option}>{option.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-reference">Reference (optional)</Label>
            <Input
              id="pay-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Cheque number, transaction ID, etc."
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Without a bill the amount is recorded as an advance payment to the supplier.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !supplierId || !(Number(amount) > 0)}>
            {pending ? "Saving…" : "Save payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
