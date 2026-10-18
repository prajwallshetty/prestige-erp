"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { cancelInvoiceAction } from "./actions";

export function CancelInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await cancelInvoiceAction({ invoiceId, reason });
      if (result.ok) {
        toast.success("Invoice cancelled — stock restored");
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
        <Button variant="outline" className="text-destructive hover:bg-destructive/10">
          <XCircle /> Cancel invoice
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this invoice?</DialogTitle>
          <DialogDescription>
            Stock is restored, serials are released back to inventory and the customer
            balance is recalculated. This cannot be reversed.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason for cancellation (required)"
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Keep invoice
          </Button>
          <Button variant="destructive" onClick={submit} disabled={pending || reason.trim().length < 3}>
            {pending ? "Cancelling…" : "Cancel invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
