"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { convertQuotationAction } from "./actions";

export function ConvertForm({
  quotationId,
  customerId,
  total,
  canCollectPayment,
}: {
  quotationId: string;
  customerId: string;
  total: number;
  canCollectPayment: boolean;
}) {
  const router = useRouter();
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await convertQuotationAction({
        quotationId,
        customerId,
        paymentAmount: canCollectPayment ? Number(paymentAmount) || undefined : undefined,
        paymentMethod: canCollectPayment ? (paymentMethod as never) : undefined,
      });
      if (result.ok) {
        toast.success(`Invoice ${result.data.invoiceNumber} created`);
        router.push(`/invoices/${result.data.invoiceId}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Payment (optional)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {canCollectPayment ? (
          <div className="flex flex-wrap gap-2">
            <Input
              className="w-40 numeric"
              placeholder={`Advance (total ${total.toFixed(0)})`}
              value={paymentAmount}
              onChange={(event) => setPaymentAmount(event.target.value)}
            />
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger className="w-40" aria-label="Method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE"].map((method) => (
                  <SelectItem key={method} value={method}>{method.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <Button className="w-full" size="lg" onClick={submit} disabled={pending}>
          {pending ? "Converting…" : "Create invoice"}
        </Button>
      </CardContent>
    </Card>
  );
}
