"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAD_STAGE_LABELS } from "@/lib/sales-config";
import { addFollowUpAction, checkLeadDuplicatesAction, createLeadAction } from "./actions";

interface Duplicates {
  leads: { id: string; leadNumber: string; name: string; stage: string; owner: string | null; canOpen: boolean }[];
  customers: { id: string; name: string; code: string }[];
}

const NONE = "__none";

export function NewLeadButton({
  sources,
  campaigns,
  owners,
  canAssign,
  currentUserId,
}: {
  sources: string[];
  campaigns: { id: string; name: string }[];
  owners: { id: string; name: string }[];
  canAssign: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    location: "",
    source: "",
    sourceDetail: "",
    campaignId: NONE,
    requirements: "",
    interests: "",
    budget: "",
    remarks: "",
    assignedToId: currentUserId,
    followUp: "",
  });
  const [duplicates, setDuplicates] = useState<Duplicates | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };

  const checkDuplicates = async () => {
    setAcknowledged(false);
    if (form.phone.replace(/\D/g, "").length < 7) return setDuplicates(null);
    const result = await checkLeadDuplicatesAction({ phone: form.phone });
    setDuplicates(result.ok && (result.data.leads.length || result.data.customers.length) ? result.data : null);
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Customer name is required";
    if (form.phone.replace(/\D/g, "").length < 7) next.phone = "Enter a valid phone number";
    if (!form.source && form.campaignId === NONE) next.source = "Where did this lead come from?";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = "Enter a valid email";
    if (form.budget && !(Number(form.budget) >= 0)) next.budget = "Budget must be a positive number";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    startTransition(async () => {
      const result = await createLeadAction({
        name: form.name,
        phone: form.phone,
        email: form.email || null,
        location: form.location || null,
        source: form.source || null,
        sourceDetail: form.sourceDetail || null,
        campaignId: form.campaignId === NONE ? null : form.campaignId,
        requirements: form.requirements || null,
        productInterests: form.interests.split(",").map((s) => s.trim()).filter(Boolean),
        estimatedBudget: form.budget ? Number(form.budget) : null,
        remarks: form.remarks || null,
        assignedToId: canAssign ? form.assignedToId : null,
        allowDuplicate: acknowledged,
      });
      if (!result.ok) {
        // A duplicate hit shows the panel again rather than just a toast.
        if (/already exists/.test(result.error)) await checkDuplicates();
        toast.error(result.error);
        return;
      }
      if (form.followUp) {
        const fu = await addFollowUpAction({ leadId: result.data.id, dueAt: form.followUp, notes: "First follow-up" });
        if (!fu.ok) toast.error(`Lead saved, but the follow-up was not scheduled: ${fu.error}`);
      }
      toast.success(`Lead ${result.data.leadNumber} created${result.data.linkedCustomer ? ` — linked to existing customer ${result.data.linkedCustomer}` : ""}`);
      setOpen(false);
      setForm((current) => ({ ...current, name: "", phone: "", email: "", location: "", requirements: "", interests: "", budget: "", remarks: "", sourceDetail: "", followUp: "" }));
      setDuplicates(null);
      router.push(`/leads/${result.data.id}`);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New lead
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New lead</DialogTitle>
          <DialogDescription>Capture the enquiry now — you can refine it and add interactions later.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer name *" error={errors.name}>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Phone *" error={errors.phone}>
            <Input value={form.phone} inputMode="tel" onChange={(e) => set("phone", e.target.value)} onBlur={checkDuplicates} autoComplete="off" />
          </Field>

          {duplicates ? (
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm sm:col-span-2" role="alert">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-4" /> This phone number is already in the system
              </p>
              {duplicates.leads.map((lead) => (
                <p key={lead.id} className="text-muted-foreground">
                  Lead{" "}
                  {lead.canOpen ? (
                    <Link href={`/leads/${lead.id}`} className="text-primary hover:underline" target="_blank">{lead.leadNumber}</Link>
                  ) : (
                    lead.leadNumber
                  )}{" "}
                  — {lead.name}, {LEAD_STAGE_LABELS[lead.stage]?.toLowerCase()}
                  {lead.owner ? `, owned by ${lead.owner}` : ""}
                </p>
              ))}
              {duplicates.customers.map((customer) => (
                <p key={customer.id} className="text-muted-foreground">
                  Existing customer {customer.name} ({customer.code}) — the new lead will be linked to them.
                </p>
              ))}
              {duplicates.leads.length > 0 ? (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                  <span>This is a different enquiry — create it anyway</span>
                </label>
              ) : null}
            </div>
          ) : null}

          <Field label="Location / area">
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="City or locality" />
          </Field>
          <Field label="Email" error={errors.email}>
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>

          <Field label="Lead source *" error={errors.source}>
            <Select value={form.source || NONE} onValueChange={(v) => set("source", v === NONE ? "" : v)}>
              <SelectTrigger aria-label="Lead source"><SelectValue placeholder="Select source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{form.campaignId !== NONE ? "Same as campaign channel" : "Select source…"}</SelectItem>
                {sources.map((source) => <SelectItem key={source} value={source}>{source}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Marketing campaign (optional)">
            <Select value={form.campaignId} onValueChange={(v) => set("campaignId", v)}>
              <SelectTrigger aria-label="Campaign"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No campaign</SelectItem>
                {campaigns.map((campaign) => <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          {form.source === "Referral" ? (
            <Field label="Referred by" className="sm:col-span-2">
              <Input value={form.sourceDetail} onChange={(e) => set("sourceDetail", e.target.value)} />
            </Field>
          ) : null}

          <Field label="Requirements" className="sm:col-span-2">
            <Textarea rows={2} value={form.requirements} onChange={(e) => set("requirements", e.target.value)} placeholder="Rooms, areas, size and finish preferences…" />
          </Field>
          <Field label="Product interests">
            <Input value={form.interests} onChange={(e) => set("interests", e.target.value)} placeholder="e.g. Vitrified, Wall tiles, Kajaria" />
          </Field>
          <Field label="Estimated budget (₹)" error={errors.budget}>
            <Input type="number" min="0" step="1" value={form.budget} onChange={(e) => set("budget", e.target.value)} />
          </Field>

          {canAssign ? (
            <Field label="Assigned to">
              <Select value={form.assignedToId} onValueChange={(v) => set("assignedToId", v)}>
                <SelectTrigger aria-label="Assigned to"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {owners.map((owner) => <SelectItem key={owner.id} value={owner.id}>{owner.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label="First follow-up on">
            <Input type="date" value={form.followUp} min={new Date().toISOString().slice(0, 10)} onChange={(e) => set("followUp", e.target.value)} />
          </Field>

          <Field label="Remarks" className="sm:col-span-2">
            <Textarea rows={2} value={form.remarks} onChange={(e) => set("remarks", e.target.value)} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || Boolean(duplicates?.leads.length && !acknowledged)}>
            {pending ? "Saving…" : "Create lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, error, className, children }: { label: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
