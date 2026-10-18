"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CAMPAIGN_STATUS_LABELS } from "@/lib/sales-config";
import { createCampaignAction, updateCampaignAction } from "../actions";

export interface CampaignFormValues {
  id?: string;
  name: string;
  description: string;
  type: string;
  channel: string;
  status: string;
  startDate: string;
  endDate: string;
  targetAudience: string;
  targetLocation: string;
  budget: string;
  actualSpend: string;
  notes: string;
  ownerId: string;
  isPromotion: boolean;
  offerValidFrom: string;
  offerValidTo: string;
  discountType: string;
  discountValue: string;
  minOrderValue: string;
  promoCode: string;
}

export const EMPTY_CAMPAIGN: CampaignFormValues = {
  name: "", description: "", type: "", channel: "", status: "DRAFT", startDate: "", endDate: "", targetAudience: "", targetLocation: "",
  budget: "", actualSpend: "", notes: "", ownerId: "__none", isPromotion: false, offerValidFrom: "", offerValidTo: "",
  discountType: "PERCENT", discountValue: "", minOrderValue: "", promoCode: "",
};

const TYPE_SUGGESTIONS = ["Digital ad", "Social media", "Print / hoarding", "Event / exhibition", "Showroom promotion", "Referral programme", "Dealer / architect outreach"];

export function CampaignFormButton({
  channels,
  owners,
  initial,
}: {
  channels: string[];
  owners: { id: string; name: string }[];
  initial?: CampaignFormValues;
}) {
  const router = useRouter();
  const editing = Boolean(initial?.id);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CampaignFormValues>(initial ?? EMPTY_CAMPAIGN);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof CampaignFormValues>(key: K, value: CampaignFormValues[K]) => setForm((cur) => ({ ...cur, [key]: value }));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const submit = () =>
    startTransition(async () => {
      const payload = {
        name: form.name,
        description: form.description || null,
        type: form.type,
        channel: form.channel,
        status: form.status as never,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        targetAudience: form.targetAudience || null,
        targetLocation: form.targetLocation || null,
        // Blank stays null ("not recorded") — it is never silently saved as 0.
        budget: num(form.budget),
        actualSpend: num(form.actualSpend),
        notes: form.notes || null,
        ownerId: form.ownerId === "__none" ? null : form.ownerId,
        isPromotion: form.isPromotion,
        offerValidFrom: form.offerValidFrom || null,
        offerValidTo: form.offerValidTo || null,
        discountType: form.isPromotion ? (form.discountType as never) : null,
        discountValue: form.isPromotion ? num(form.discountValue) : null,
        minOrderValue: form.isPromotion ? num(form.minOrderValue) : null,
        promoCode: form.promoCode || null,
      };
      const result = editing ? await updateCampaignAction({ ...payload, campaignId: initial!.id! }) : await createCampaignAction(payload);
      if (result.ok) {
        toast.success(editing ? "Campaign updated" : "Campaign created");
        setOpen(false);
        if (!editing) {
          setForm(EMPTY_CAMPAIGN);
          router.push(`/marketing/campaigns/${result.data.id}`);
        }
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="outline"><Pencil /> Edit</Button>
        ) : (
          <Button><Plus /> New campaign</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit campaign" : "New campaign"}</DialogTitle>
          <DialogDescription>
            Leave budget or spend blank if it is not known — reports show “—” instead of treating it as zero.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label>Campaign name *</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Type *</Label>
            <Input list="campaign-types" value={form.type} onChange={(e) => set("type", e.target.value)} placeholder="e.g. Digital ad" />
            <datalist id="campaign-types">{TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
          <div className="space-y-1.5">
            <Label>Channel *</Label>
            <Select value={form.channel || "__none"} onValueChange={(v) => set("channel", v === "__none" ? "" : v)}>
              <SelectTrigger aria-label="Channel"><SelectValue placeholder="Select channel" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Select channel…</SelectItem>
                {channels.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(CAMPAIGN_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Marketing owner</Label>
            <Select value={form.ownerId} onValueChange={(v) => set("ownerId", v)}>
              <SelectTrigger aria-label="Owner"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Unassigned</SelectItem>
                {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Start date</Label><Input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>End date</Label><Input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Target audience</Label><Input value={form.targetAudience} onChange={(e) => set("targetAudience", e.target.value)} placeholder="e.g. Home builders, architects" /></div>
          <div className="space-y-1.5"><Label>Target location</Label><Input value={form.targetLocation} onChange={(e) => set("targetLocation", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Budget (₹)</Label><Input type="number" min="0" value={form.budget} onChange={(e) => set("budget", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Actual spend (₹)</Label><Input type="number" min="0" value={form.actualSpend} onChange={(e) => set("actualSpend", e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.isPromotion} onChange={(e) => set("isPromotion", e.target.checked)} />
            <span className="font-medium">This campaign carries an offer / promotion</span>
          </label>
          {form.isPromotion ? (
            <>
              <div className="space-y-1.5">
                <Label>Discount type</Label>
                <Select value={form.discountType} onValueChange={(v) => set("discountType", v)}>
                  <SelectTrigger aria-label="Discount type"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="PERCENT">Percentage</SelectItem><SelectItem value="FLAT">Flat amount (₹)</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Discount value *</Label><Input type="number" min="0" value={form.discountValue} onChange={(e) => set("discountValue", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Offer valid from</Label><Input type="date" value={form.offerValidFrom} onChange={(e) => set("offerValidFrom", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Offer valid to</Label><Input type="date" value={form.offerValidTo} onChange={(e) => set("offerValidTo", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Minimum order (₹)</Label><Input type="number" min="0" value={form.minOrderValue} onChange={(e) => set("minOrderValue", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Promo code</Label><Input value={form.promoCode} onChange={(e) => set("promoCode", e.target.value)} /></div>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !form.name.trim() || !form.type.trim() || !form.channel}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
