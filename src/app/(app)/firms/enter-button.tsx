"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { enterFirmAction } from "./actions";

export function EnterFirmButton({
  firmId,
  firmName,
  disabled,
}: {
  firmId: string;
  firmName: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      disabled={disabled || pending}
      onClick={() =>
        startTransition(async () => {
          const result = await enterFirmAction({ firmId });
          if (result.ok) {
            toast.success(`Now operating in ${firmName}`);
            router.push("/dashboard");
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <LogIn /> {pending ? "Entering…" : "Enter firm"}
    </Button>
  );
}
