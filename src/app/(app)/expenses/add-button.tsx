"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
import { createExpenseAction } from "./actions";

const CATEGORIES = [
  "RENT", "ELECTRICITY", "INTERNET", "SALARY", "TRANSPORT", "OFFICE", "MARKETING", "MAINTENANCE", "OTHER",
];

export function AddExpenseButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: "OFFICE", amount: "", description: "", paidTo: "" });
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await createExpenseAction({
        category: form.category as never,
        amount: Number(form.amount),
        description: form.description,
        paidTo: form.paidTo || null,
      });
      if (result.ok) {
        toast.success(`Expense ${result.data.expenseNumber} recorded`);
        setOpen(false);
        setForm({ category: "OFFICE", amount: "", description: "", paidTo: "" });
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus /> Record expense</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record expense</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(value) => setForm((c) => ({ ...c, category: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category.charAt(0) + category.slice(1).toLowerCase().replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-amount">Amount (₹) *</Label>
            <Input id="exp-amount" className="numeric" type="number" min="1" value={form.amount}
              onChange={(e) => setForm((c) => ({ ...c, amount: e.target.value }))} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="exp-desc">Description *</Label>
            <Textarea id="exp-desc" rows={2} value={form.description}
              onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="exp-paid">Paid to</Label>
            <Input id="exp-paid" value={form.paidTo}
              onChange={(e) => setForm((c) => ({ ...c, paidTo: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !(Number(form.amount) > 0) || !form.description.trim()}>
            {pending ? "Saving…" : "Record expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
