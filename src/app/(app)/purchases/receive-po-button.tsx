"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/money";
import { parseNumericInput, tidyAmountOnBlur, tidyQuantityOnBlur } from "@/lib/numeric-input";
import { receiveGoodsAction } from "./actions";

interface PoLine {
  id: string;
  productId: string;
  description: string;
  quantity: number;
  receivedQuantity: number;
  unitPrice: number;
  trackSerials: boolean;
}

interface PoSummary {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  lines: PoLine[];
}

interface Line {
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  quantity: string;
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  unitPrice: string;
  serials: string;
}

/**
 * Receives goods against a specific purchase order: lines start pre-filled with
 * the remaining (ordered − received) quantities at the PO's prices, and the
 * receipt updates that PO's progress when saved.
 */
export function ReceivePoButton({ po }: { po: PoSummary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplierRef, setSupplierRef] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [lines, setLines] = useState<Line[]>(() =>
    po.lines.map((line) => ({
      quantity: String(Math.max(0, line.quantity - line.receivedQuantity)),
      unitPrice: String(Number(line.unitPrice)),
      serials: "",
    })),
  );
  const [pending, startTransition] = useTransition();

  const setLine = (index: number, updates: Partial<Line>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...updates } : line)));

  const receivableLines = po.lines.map((line, index) => ({ line, index }));

  const submit = () => {
    startTransition(async () => {
      const payload = receivableLines
        .filter(({ index }) => parseNumericInput(lines[index].quantity) > 0)
        .map(({ line, index }) => ({
          productId: line.productId,
          quantity: parseNumericInput(lines[index].quantity),
          unitPrice: parseNumericInput(lines[index].unitPrice),
          serialNumbers: line.trackSerials
            ? lines[index].serials.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
            : undefined,
        }));
      if (payload.length === 0) {
        toast.error("Enter at least one quantity to receive");
        return;
      }
      const result = await receiveGoodsAction({
        supplierId: po.supplierId,
        poId: po.id,
        supplierRef: supplierRef || null,
        paymentAmount: Number(paymentAmount) || undefined,
        lines: payload,
      });
      if (result.ok) {
        toast.success(`Goods received — bill ${result.data.invoiceNumber}`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const total = receivableLines.reduce(
    (sum, { index }) => sum + parseNumericInput(lines[index].quantity) * parseNumericInput(lines[index].unitPrice),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <PackageCheck /> Receive
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receive goods for {po.poNumber}</DialogTitle>
          <DialogDescription>
            Quantities start at what&apos;s still outstanding. Stock and the supplier bill are booked when you save.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {receivableLines.map(({ line, index }) => {
            const remaining = line.quantity - line.receivedQuantity;
            const fullyReceived = remaining <= 0;
            return (
              <div key={line.id} className="space-y-1.5 rounded-lg border border-border p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">{line.description}</span>
                  <span className="numeric shrink-0 text-xs text-muted-foreground">
                    ordered {line.quantity} · received {line.receivedQuantity}
                  </span>
                </div>
                {fullyReceived ? (
                  <p className="text-xs text-muted-foreground">Fully received — nothing outstanding.</p>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="w-24">
                      <Label className="text-xs text-muted-foreground">Receive qty</Label>
                      <Input
                        className="numeric h-8"
                        type="number"
                        min="0"
                        value={lines[index].quantity}
                        onChange={(e) => setLine(index, { quantity: e.target.value })}
                        onBlur={(e) => setLine(index, { quantity: tidyQuantityOnBlur(e.target.value) })}
                        aria-label={`Receive quantity for ${line.description}`}
                      />
                    </div>
                    <div className="w-32">
                      <Label className="text-xs text-muted-foreground">Cost (₹)</Label>
                      <Input
                        className="numeric h-8"
                        type="number"
                        min="0"
                        step="0.01"
                        value={lines[index].unitPrice}
                        onChange={(e) => setLine(index, { unitPrice: e.target.value })}
                        onBlur={(e) => setLine(index, { unitPrice: tidyAmountOnBlur(e.target.value) })}
                        aria-label={`Cost for ${line.description}`}
                      />
                    </div>
                    <span className="numeric ml-auto pt-5 text-sm font-semibold">
                      {formatCurrency(parseNumericInput(lines[index].quantity) * parseNumericInput(lines[index].unitPrice))}
                    </span>
                  </div>
                )}
                {line.trackSerials && !fullyReceived ? (
                  <div>
                    <Label className="text-xs">Serial numbers ({parseNumericInput(lines[index].quantity)} needed)</Label>
                    <Textarea
                      className="mt-1 min-h-16 font-mono text-xs"
                      placeholder="One serial / IMEI per line"
                      value={lines[index].serials}
                      onChange={(e) => setLine(index, { serials: e.target.value })}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm font-medium">
          <span>Receipt total</span>
          <span className="numeric">{formatCurrency(total)}</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`sup-ref-${po.id}`}>Supplier bill no.</Label>
            <Input id={`sup-ref-${po.id}`} value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`po-pay-${po.id}`}>Paid to supplier now (₹, optional)</Label>
            <Input
              id={`po-pay-${po.id}`}
              className="numeric"
              type="number"
              min="0"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Record receipt & bill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
