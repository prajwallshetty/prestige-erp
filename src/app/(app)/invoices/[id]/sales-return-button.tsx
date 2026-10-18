"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseNumericInput, tidyOptionalQuantityOnBlur } from "@/lib/numeric-input";
import { createSalesReturnAction } from "./actions";

const REFUND_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" },
] as const;

export interface ReturnableLine {
  invoiceLineId: string;
  description: string;
  quantity: number;
  returnedQty: number;
  unitPrice: number;
  serialNumbers: string[];
}

export function SalesReturnButton({
  invoiceId,
  lines,
}: {
  invoiceId: string;
  lines: ReturnableLine[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("CASH");
  /** Per-line raw input text — kept as strings so fields can be cleared while editing. */
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const returnable = lines.filter((l) => l.quantity > l.returnedQty);
  const total = lines.reduce(
    (sum, l) => sum + parseNumericInput(qtys[l.invoiceLineId] ?? "") * l.unitPrice,
    0,
  );

  const submit = () => {
    startTransition(async () => {
      const payloadLines = returnable
        .map((l): { invoiceLineId: string; quantity: number; serialNumbers?: string[] } | null => {
          const quantity = parseNumericInput(qtys[l.invoiceLineId] ?? "");
          if (quantity <= 0) return null;
          const serialList = l.serialNumbers.length
            ? (serials[l.invoiceLineId] ?? "")
                .split(/[\n,]/)
                .map((s) => s.trim())
                .filter(Boolean)
                .slice(0, quantity)
            : undefined;
          return {
            invoiceLineId: l.invoiceLineId,
            quantity,
            serialNumbers: serialList,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      if (payloadLines.length === 0) {
        toast.error("Enter a quantity for at least one item");
        return;
      }

      const result = await createSalesReturnAction({
        invoiceId,
        lines: payloadLines,
        reason,
        refundMethod: method as never,
      });
      if (result.ok) {
        toast.success(`Return ${result.data.returnNumber} recorded — awaiting approval`);
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
        <Button variant="outline" disabled={returnable.length === 0}>
          <Undo2 /> New return
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record a sales return</DialogTitle>
          <DialogDescription>
            Once approved, the stock is restored and the customer is refunded.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {returnable.map((line) => (
            <div key={line.invoiceLineId} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{line.description}</span>
                <span className="numeric text-muted-foreground">
                  ₹{line.unitPrice.toFixed(2)} · sold {line.quantity}, returned {line.returnedQty}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min="1"
                    max={line.quantity - line.returnedQty}
                    value={qtys[line.invoiceLineId] ?? ""}
                    onChange={(e) =>
                      setQtys((prev) => ({
                        ...prev,
                        [line.invoiceLineId]: e.target.value,
                      }))
                    }
                    onBlur={(e) =>
                      setQtys((prev) => ({
                        ...prev,
                        [line.invoiceLineId]: tidyOptionalQuantityOnBlur(e.target.value),
                      }))
                    }
                  />
                </div>
                {line.serialNumbers.length > 0 ? (
                  <div className="space-y-1">
                    <Label>Serial / IMEI</Label>
                    <Input
                      value={serials[line.invoiceLineId] ?? ""}
                      placeholder="Scan or type the serial"
                      onChange={(e) =>
                        setSerials((prev) => ({
                          ...prev,
                          [line.invoiceLineId]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Refund via</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REFUND_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Refund amount</Label>
              <div className="rounded-md border border-border px-3 py-2 numeric font-medium">
                ₹{total.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Reason (required)</Label>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is the customer returning this?"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={pending || reason.trim().length < 3}
          >
            {pending ? "Saving…" : "Record return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
