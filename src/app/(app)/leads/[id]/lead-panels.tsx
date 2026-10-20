"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAD_ACTIVITY_LABELS, LEAD_STAGES, LEAD_STAGE_LABELS, LOGGABLE_ACTIVITY_TYPES } from "@/lib/sales-config";
import { formatDate } from "@/lib/dates";
import {
  addFollowUpAction,
  assignLeadAction,
  changeLeadStageAction,
  completeFollowUpAction,
  logActivityAction,
  prepareLeadQuotationAction,
  setLeadAttributionAction,
  updateLeadAction,
} from "../actions";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, done?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(success);
        done?.();
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong");
      }
    });
  return { run, pending, router };
}

export function StageControl({ leadId, stage, lostReasons }: { leadId: string; stage: string; lostReasons: string[] }) {
  const { run, pending } = useRun();
  const [lostOpen, setLostOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");

  const change = (next: string) => {
    if (next === stage) return;
    if (next === "LOST") return setLostOpen(true);
    run(() => changeLeadStageAction({ leadId, stage: next }), `Moved to ${LEAD_STAGE_LABELS[next]}`);
  };

  return (
    <>
      <Select value={stage} onValueChange={change} disabled={pending}>
        <SelectTrigger className="h-9 w-48" aria-label="Lead stage"><SelectValue /></SelectTrigger>
        <SelectContent>
          {LEAD_STAGES.map((s) => (
            <SelectItem key={s} value={s} disabled={s === "QUOTATION_SENT" && stage !== "QUOTATION_SENT"}>
              {LEAD_STAGE_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark lead as lost</DialogTitle>
            <DialogDescription>The reason feeds the marketing and sales reports.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger aria-label="Reason"><SelectValue placeholder="Select a reason" /></SelectTrigger>
              <SelectContent>
                {lostReasons.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
            <Textarea rows={2} value={other} onChange={(e) => setOther(e.target.value)} placeholder="Details (optional)" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!reason || pending}
              onClick={() =>
                run(() => changeLeadStageAction({ leadId, stage: "LOST", lostReason: reason, notes: other || null }), "Lead marked as lost", () => setLostOpen(false))
              }
            >
              Mark as lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AssignControl({ leadId, assigneeId, owners }: { leadId: string; assigneeId: string | null; owners: { id: string; name: string }[] }) {
  const { run, pending } = useRun();
  return (
    <Select
      value={assigneeId ?? "__none"}
      disabled={pending}
      onValueChange={(v) => run(() => assignLeadAction({ leadId, assigneeId: v === "__none" ? null : v }), "Lead reassigned")}
    >
      <SelectTrigger className="h-8 w-44" aria-label="Assigned to"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">Unassigned</SelectItem>
        {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function CreateQuotationButton({ leadId }: { leadId: string }) {
  const { run, pending, router } = useRun();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        run(
          async () => {
            const result = await prepareLeadQuotationAction({ leadId });
            if (result.ok) router.push(`/quotations?lead=${leadId}`);
            return result;
          },
          "Opening quotation…",
        )
      }
    >
      <FileText /> Create quotation
    </Button>
  );
}

export function LogActivityForm({ leadId }: { leadId: string }) {
  const { run, pending } = useRun();
  const [type, setType] = useState<string>("CALL");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-9 w-40" aria-label="Interaction type"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LOGGABLE_ACTIVITY_TYPES.map((t) => <SelectItem key={t} value={t}>{LEAD_ACTIVITY_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="h-9 min-w-40 flex-1" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Outcome (e.g. Interested, call back)" />
      </div>
      <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was discussed?" aria-label="Notes" />
      <Button
        size="sm"
        disabled={pending || !notes.trim()}
        onClick={() =>
          run(
            () => logActivityAction({ leadId, type: type as never, notes, outcome: outcome || null }),
            "Interaction recorded",
            () => {
              setNotes("");
              setOutcome("");
            },
          )
        }
      >
        <Plus /> Record interaction
      </Button>
    </div>
  );
}

export function FollowUpPanel({
  leadId,
  closed,
  quotations,
  followUps,
}: {
  leadId: string;
  closed: boolean;
  quotations: { id: string; quotationNumber: string }[];
  followUps: { id: string; dueAt: string; notes: string | null; completedAt: string | null; overdue: boolean }[];
}) {
  const { run, pending } = useRun();
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  const [quotationId, setQuotationId] = useState("__none");
  const [doneNotes, setDoneNotes] = useState<Record<string, string>>({});

  return (
    <div className="space-y-3">
      {!closed ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Next follow-up</Label>
            <Input type="date" className="h-9 w-40" value={due} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Input className="h-9 min-w-40 flex-1" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What to do (e.g. send revised rates)" />
          {quotations.length > 0 ? (
            <Select value={quotationId} onValueChange={setQuotationId}>
              <SelectTrigger className="h-9 w-44" aria-label="Quotation"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No quotation</SelectItem>
                {quotations.map((q) => <SelectItem key={q.id} value={q.id}>{q.quotationNumber}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            size="sm"
            disabled={pending || !due}
            onClick={() =>
              run(
                () => addFollowUpAction({ leadId, dueAt: due, notes: notes || null, quotationId: quotationId === "__none" ? null : quotationId }),
                "Follow-up scheduled",
                () => {
                  setDue("");
                  setNotes("");
                  setQuotationId("__none");
                },
              )
            }
          >
            Schedule
          </Button>
        </div>
      ) : null}

      {followUps.length === 0 ? (
        <p className="text-sm text-muted-foreground">{closed ? "No follow-ups were recorded." : "No follow-ups scheduled yet."}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {followUps.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className={f.completedAt ? "text-muted-foreground line-through" : f.overdue ? "font-medium text-destructive" : "font-medium"}>
                {formatDate(f.dueAt)}
                {f.overdue && !f.completedAt ? " · overdue" : ""}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.notes ?? "—"}</span>
              {f.completedAt ? (
                <span className="text-xs text-success">Done {formatDate(f.completedAt)}</span>
              ) : (
                <>
                  <Input
                    className="h-8 w-40"
                    placeholder="Outcome (optional)"
                    value={doneNotes[f.id] ?? ""}
                    onChange={(e) => setDoneNotes((cur) => ({ ...cur, [f.id]: e.target.value }))}
                    aria-label="Follow-up outcome"
                  />
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => completeFollowUpAction({ followUpId: f.id, leadId, notes: doneNotes[f.id] || null }), "Follow-up completed")}>
                    <Check /> Done
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EditLeadButton({
  lead,
}: {
  lead: { id: string; name: string; phone: string; email: string | null; location: string | null; requirements: string | null; productInterests: string[]; estimatedBudget: number | null; remarks: string | null };
}) {
  const { run, pending } = useRun();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: lead.name,
    phone: lead.phone,
    email: lead.email ?? "",
    location: lead.location ?? "",
    requirements: lead.requirements ?? "",
    interests: lead.productInterests.join(", "),
    budget: lead.estimatedBudget != null ? String(lead.estimatedBudget) : "",
    remarks: lead.remarks ?? "",
  });
  const set = (key: keyof typeof form, value: string) => setForm((cur) => ({ ...cur, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Pencil /> Edit</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit lead</DialogTitle>
          <DialogDescription>Source and campaign are the lead&apos;s original attribution and are not edited here.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Name *</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Phone *</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Location</Label><Input value={form.location} onChange={(e) => set("location", e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Requirements</Label><Textarea rows={2} value={form.requirements} onChange={(e) => set("requirements", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Product interests</Label><Input value={form.interests} onChange={(e) => set("interests", e.target.value)} placeholder="Comma separated" /></div>
          <div className="space-y-1.5"><Label>Estimated budget (₹)</Label><Input type="number" min="0" value={form.budget} onChange={(e) => set("budget", e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Remarks</Label><Textarea rows={2} value={form.remarks} onChange={(e) => set("remarks", e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={pending || !form.name.trim() || !form.phone.trim()}
            onClick={() =>
              run(
                () =>
                  updateLeadAction({
                    leadId: lead.id,
                    name: form.name,
                    phone: form.phone,
                    email: form.email || null,
                    location: form.location || null,
                    requirements: form.requirements || null,
                    productInterests: form.interests.split(",").map((s) => s.trim()).filter(Boolean),
                    estimatedBudget: form.budget ? Number(form.budget) : null,
                    remarks: form.remarks || null,
                  }),
                "Lead updated",
                () => setOpen(false),
              )
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Restricted, audited correction of the lead's original source / campaign. */
export function AttributionButton({
  leadId,
  source,
  campaignId,
  sources,
  campaigns,
}: {
  leadId: string;
  source: string;
  campaignId: string | null;
  sources: string[];
  campaigns: { id: string; name: string }[];
}) {
  const { run, pending } = useRun();
  const [open, setOpen] = useState(false);
  const [nextSource, setNextSource] = useState(source);
  const [nextCampaign, setNextCampaign] = useState(campaignId ?? "__none");
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">Correct</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Correct lead attribution</DialogTitle>
          <DialogDescription>The original source drives marketing reports, so every correction is recorded with your reason.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={nextSource} onValueChange={setNextSource}>
            <SelectTrigger aria-label="Source"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[...new Set([source, ...sources])].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={nextCampaign} onValueChange={setNextCampaign}>
            <SelectTrigger aria-label="Campaign"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">No campaign</SelectItem>
              {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being corrected? *" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={pending || !reason.trim()}
            onClick={() =>
              run(
                () => setLeadAttributionAction({ leadId, source: nextSource, campaignId: nextCampaign === "__none" ? null : nextCampaign, reason }),
                "Attribution corrected",
                () => setOpen(false),
              )
            }
          >
            Save correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
