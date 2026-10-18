"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Plus, Trash2 } from "lucide-react";
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
import { parseNumericInput, tidyQuantityOnBlur } from "@/lib/numeric-input";
import { createTransferAction } from "./actions";

interface Line {
  key: number;
  productId: string;
  productName: string;
  trackSerials: boolean;
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  quantity: string;
  serials: string;
}

let key = 0;

export function NewTransferButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string; sku: string; trackSerials: boolean }[]>([]);
  const [fromBranchId, setFromBranchId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 0, productId: "", productName: "", trackSerials: false, quantity: "1", serials: "" }]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || branches.length > 0) return;
    void Promise.all([
      fetch("/api/branches").then((r) => (r.ok ? r.json() : { branches: [] })),
      fetch("/api/products").then((r) => (r.ok ? r.json() : { products: [] })),
    ]).then(([branchData, productData]) => {
      setBranches(branchData.branches ?? []);
      setProducts(
        (productData.products ?? []).map((product: { id: string; name: string; sku: string; trackSerials?: boolean }) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          trackSerials: Boolean(product.trackSerials),
        })),
      );
    });
  }, [open, branches.length]);

  const setLine = (lineKey: number, updates: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === lineKey ? { ...line, ...updates } : line)));

  const submit = () => {
    startTransition(async () => {
      const result = await createTransferAction({
        fromBranchId,
        toBranchId,
        lines: lines
          .filter((line) => line.productId)
          .map((line) => ({
            productId: line.productId,
            quantity: parseNumericInput(line.quantity),
            serialNumbers: line.trackSerials
              ? line.serials.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
              : undefined,
          })),
      });
      if (result.ok) {
        toast.success(`Transfer ${result.data.transferNumber} created`);
        setOpen(false);
        setLines([{ key: (key += 1), productId: "", productName: "", trackSerials: false, quantity: "1", serials: "" }]);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><ArrowLeftRight /> New transfer</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>New stock transfer</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>From branch *</Label>
            <Select value={fromBranchId} onValueChange={setFromBranchId}>
              <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>To branch *</Label>
            <Select value={toBranchId} onValueChange={setToBranchId}>
              <SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger>
              <SelectContent>
                {branches.filter((branch) => branch.id !== fromBranchId).map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          {lines.map((line) => (
            <div key={line.key} className="space-y-1.5 rounded-lg border border-border p-2.5">
              <div className="flex items-center gap-2">
                <Select
                  value={line.productId}
                  onValueChange={(value) => {
                    const product = products.find((p) => p.id === value);
                    setLine(line.key, { productId: value, productName: product?.name ?? "", trackSerials: product?.trackSerials ?? false });
                  }}
                >
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Product" /></SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="w-20 numeric" type="number" min="1" value={line.quantity}
                  onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                  onBlur={(e) => setLine(line.key, { quantity: tidyQuantityOnBlur(e.target.value) })}
                  aria-label="Quantity"
                />
                <Button size="icon-sm" variant="ghost" className="text-destructive"
                  onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))} aria-label="Remove">
                  <Trash2 />
                </Button>
              </div>
              {line.trackSerials ? (
                <div>
                  <Label className="text-xs">Serial numbers</Label>
                  <Textarea className="mt-1 min-h-16 font-mono text-xs" placeholder="One serial per line"
                    value={line.serials} onChange={(e) => setLine(line.key, { serials: e.target.value })} />
                </div>
              ) : null}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setLines((c) => [...c, { key: (key += 1), productId: "", productName: "", trackSerials: false, quantity: "1", serials: "" }])}>
            <Plus /> Add item
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !fromBranchId || !toBranchId || fromBranchId === toBranchId}>
            {pending ? "Creating…" : "Create transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
