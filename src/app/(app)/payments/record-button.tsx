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
import { recordPaymentAction } from "./actions";

interface CustomerOption {
  id: string;
  name: string;
  phone: string;
}

export function RecordPaymentButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [pending, startTransition] = useTransition();

  const loadCustomers = () => {
    if (customers.length > 0) return;
    fetch("/api/customers")
      .then((response) => (response.ok ? response.json() : { customers: [] }))
      .then((data) => setCustomers(data.customers ?? []))
      .catch(() => setCustomers([]));
  };

  const customerOptions: SearchableOption[] = customers.map((customer) => ({
    value: customer.id,
    label: customer.name,
    hint: customer.phone,
  }));

  const submit = () => {
    startTransition(async () => {
      const result = await recordPaymentAction({
        customerId,
        amount: Number(amount),
        method: method as never,
      });
      if (result.ok) {
        toast.success(`Payment ${result.data.paymentNumber} recorded`);
        setOpen(false);
        setAmount("");
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
        if (next) loadCustomers();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Wallet /> Record payment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record customer payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pay-customer">Customer</Label>
            <SearchableSelect
              ariaLabel="Customer"
              options={customerOptions}
              value={customerId}
              onValueChange={setCustomerId}
              placeholder="Search customer by name or phone…"
              emptyMessage="No customers match"
            />
          </div>
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
                {["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE"].map((option) => (
                  <SelectItem key={option} value={option}>{option.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Without an invoice the amount is recorded as an advance on the customer's account.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !customerId || !(Number(amount) > 0)}>
            {pending ? "Saving…" : "Save payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
