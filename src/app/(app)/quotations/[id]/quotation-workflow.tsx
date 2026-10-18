"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Mail, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WhatsAppShareButton } from "@/components/shared/whatsapp-share-button";
import {
  markQuotationSharedAction,
  reviewQuotationAction,
  submitQuotationForReviewAction,
} from "../actions";

/** Share the quotation (WhatsApp / email) and record that it was sent. */
export function QuotationShare({
  quotationId,
  quotationNumber,
  customerPhone,
  customerEmail,
  disabled,
}: {
  quotationId: string;
  quotationNumber: string;
  customerPhone?: string;
  customerEmail?: string | null;
  /** Sharing is blocked (e.g. discount awaiting approval); the page explains why. */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const markShared = (via: string) =>
    startTransition(async () => {
      const result = await markQuotationSharedAction({ quotationId, via });
      if (result.ok) {
        toast.success("Marked as sent");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  if (disabled) return null;

  const subject = encodeURIComponent(`Quotation ${quotationNumber}`);
  const body = encodeURIComponent(
    `Please find quotation ${quotationNumber}:\n${typeof window !== "undefined" ? window.location.origin : ""}/api/documents/quotation/${quotationId}\n`,
  );

  return (
    <>
      <WhatsAppShareButton
        documentId={quotationId}
        documentType="quotation"
        documentNumber={quotationNumber}
        customerPhone={customerPhone}
        onShared={() => markShared("whatsapp")}
      />
      {customerEmail ? (
        <Button asChild variant="outline" disabled={pending}>
          <a href={`mailto:${customerEmail}?subject=${subject}&body=${body}`} onClick={() => markShared("email")}>
            <Mail /> Email
          </a>
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" onClick={() => markShared("manual")} disabled={pending}>
        <Send /> Mark as sent
      </Button>
    </>
  );
}

/** Salesperson: ask for review. Manager: approve or send back with notes. */
export function QuotationReviewActions({
  quotationId,
  reviewStatus,
  canSubmit,
  canReview,
}: {
  quotationId: string;
  reviewStatus: string;
  canSubmit: boolean;
  canReview: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(success);
        setNotes("");
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong");
      }
    });

  return (
    <div className="space-y-2">
      {canSubmit && (reviewStatus === "NONE" || reviewStatus === "REJECTED") ? (
        <Button
          size="sm"
          className="w-full"
          disabled={pending}
          onClick={() => run(() => submitQuotationForReviewAction({ quotationId }), "Submitted for manager review")}
        >
          <Send /> {reviewStatus === "REJECTED" ? "Resubmit for review" : "Submit for review"}
        </Button>
      ) : null}

      {canReview && reviewStatus === "PENDING" ? (
        <>
          <Textarea
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Notes for the salesperson (required when sending back)"
            aria-label="Review notes"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              disabled={pending}
              onClick={() => run(() => reviewQuotationAction({ quotationId, decision: "APPROVE", notes }), "Quotation approved")}
            >
              <Check /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={pending || !notes.trim()}
              onClick={() => run(() => reviewQuotationAction({ quotationId, decision: "REJECT", notes }), "Sent back to the salesperson")}
            >
              <Undo2 /> Send back
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
