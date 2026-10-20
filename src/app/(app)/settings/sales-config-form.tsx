"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveSalesConfigAction } from "./actions";

export function SalesConfigForm({
  initial,
}: {
  initial: { leadSources: string; campaignChannels: string; lostReasons: string; staleLeadDays: string; maxDiscountPercent: string };
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof values, value: string) => setValues((cur) => ({ ...cur, [key]: value }));

  const submit = () =>
    startTransition(async () => {
      const result = await saveSalesConfigAction(values);
      if (result.ok) {
        toast.success("Sales & marketing settings saved");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cfg-sources">Lead sources (one per line)</Label>
          <Textarea id="cfg-sources" rows={6} value={values.leadSources} onChange={(e) => set("leadSources", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cfg-channels">Campaign channels (one per line)</Label>
          <Textarea id="cfg-channels" rows={6} value={values.campaignChannels} onChange={(e) => set("campaignChannels", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cfg-lost">Lost-lead reasons (one per line)</Label>
          <Textarea id="cfg-lost" rows={5} value={values.lostReasons} onChange={(e) => set("lostReasons", e.target.value)} />
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cfg-discount">Discount needing manager approval above (%)</Label>
            <Input id="cfg-discount" type="number" min="0" max="100" step="0.5" value={values.maxDiscountPercent} onChange={(e) => set("maxDiscountPercent", e.target.value)} placeholder="Blank = no limit" />
            <p className="text-xs text-muted-foreground">Quotations discounted beyond this cannot be sent until a manager with approval rights signs off.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cfg-stale">Flag leads with no activity for (days)</Label>
            <Input id="cfg-stale" type="number" min="1" max="365" value={values.staleLeadDays} onChange={(e) => set("staleLeadDays", e.target.value)} placeholder="7" />
          </div>
        </div>
      </div>
      <Button onClick={submit} disabled={pending}>{pending ? "Saving…" : "Save sales & marketing settings"}</Button>
    </div>
  );
}
