"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
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
import { createUserAction } from "./actions";

const ROLES = [
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "ACCOUNTANT", label: "Accountant" },
  { value: "SALES_STAFF", label: "Sales Staff" },
  { value: "PURCHASE_STAFF", label: "Purchase Staff" },
  { value: "INVENTORY_MANAGER", label: "Inventory Manager" },
  { value: "VIEWER", label: "Viewer" },
];

export function NewUserButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ name: "", email: "", accessCode: "", role: "SALES_STAFF", branchId: "" });
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || branches.length > 0) return;
    fetch("/api/branches")
      .then((response) => (response.ok ? response.json() : { branches: [] }))
      .then((data) => {
        setBranches(data.branches ?? []);
        if (data.branches?.[0]) setForm((current) => ({ ...current, branchId: data.branches[0].id }));
      })
      .catch(() => setBranches([]));
  }, [open, branches.length]);

  const submit = () => {
    startTransition(async () => {
      const result = await createUserAction(form);
      if (result.ok) {
        toast.success(`User ${result.data.name} created — they sign in with code ${form.accessCode}`);
        setOpen(false);
        setForm({ name: "", email: "", accessCode: "", role: "SALES_STAFF", branchId: form.branchId });
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><UserPlus /> Add user</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>
            The 6-digit code is the sign-in credential — share it with the staff member securely.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="usr-name">Name *</Label>
            <Input id="usr-name" value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="usr-email">Email *</Label>
            <Input id="usr-email" type="email" value={form.email} onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="usr-code">Login code (6 digits) *</Label>
            <Input id="usr-code" className="numeric" inputMode="numeric" maxLength={6} value={form.accessCode}
              onChange={(e) => setForm((c) => ({ ...c, accessCode: e.target.value.replace(/\D/g, "") }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={(value) => setForm((c) => ({ ...c, role: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Branch</Label>
            <Select value={form.branchId} onValueChange={(value) => setForm((c) => ({ ...c, branchId: value }))}>
              <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !form.name.trim() || !form.email.trim() || form.accessCode.length !== 6 || !form.branchId}>
            {pending ? "Creating…" : "Create user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
