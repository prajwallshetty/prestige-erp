"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { advanceTransferAction } from "./actions";

const NEXT_ACTION: Record<string, { action: "request" | "approve" | "dispatch" | "receive" | "cancel"; label: string } | null> = {
  DRAFT: { action: "request", label: "Request" },
  REQUESTED: { action: "approve", label: "Approve" },
  APPROVED: { action: "dispatch", label: "Dispatch" },
  IN_TRANSIT: { action: "receive", label: "Receive" },
  RECEIVED: null,
  CANCELLED: null,
};

export function TransferWorkflowButton({ transferId, status }: { transferId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const next = NEXT_ACTION[status] ?? null;
  if (!next) return null;

  return (
    <Button
      size="sm"
      variant={next.action === "cancel" ? "ghost" : "outline"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await advanceTransferAction({ transferId, action: next.action });
          if (result.ok) toast.success(`Transfer ${result.data.status.replace("_", " ").toLowerCase()}`);
          else toast.error(result.error);
        })
      }
    >
      {pending ? "…" : next.label}
    </Button>
  );
}
