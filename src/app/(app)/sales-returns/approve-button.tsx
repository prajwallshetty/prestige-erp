"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { approveSalesReturnAction } from "./actions";

export function ApproveReturnButton({ returnId }: { returnId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await approveSalesReturnAction({ returnId });
          if (result.ok) toast.success("Return approved — stock restored, refund recorded");
          else toast.error(result.error);
        })
      }
    >
      <Check /> Approve
    </Button>
  );
}
