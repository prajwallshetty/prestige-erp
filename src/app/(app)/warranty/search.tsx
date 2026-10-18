"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { claimWarrantyAction } from "./actions";

export function WarrantySearch({ warrantyId, canClaim }: { warrantyId: string | null; canClaim: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!warrantyId || !canClaim) return null;

  return (
    <div className="flex gap-2">
      <Input
        placeholder="Claim note (optional)"
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          const note = event.currentTarget.value;
          startTransition(async () => {
            const result = await claimWarrantyAction({ warrantyId, note });
            if (result.ok) {
              toast.success("Warranty claimed");
              router.refresh();
            } else {
              toast.error(result.error);
            }
          });
        }}
      />
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await claimWarrantyAction({ warrantyId, note: undefined });
            if (result.ok) {
              toast.success("Warranty claimed");
              router.refresh();
            } else {
              toast.error(result.error);
            }
          })
        }
      >
        {pending ? "Claiming…" : "Claim warranty"}
      </Button>
    </div>
  );
}
