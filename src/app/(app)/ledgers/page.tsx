import Link from "next/link";
import { BookOpen } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermissionInFirm } from "@/lib/session";
import { LEDGER_KINDS, LEDGER_META } from "@/lib/ledger/types";

export const metadata = { title: "Ledgers — Technic Technologies" };

export default async function LedgersPage() {
  const user = await requirePermissionInFirm(["reports.view", "payments.view"]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Ledgers"
        description={`Every ledger is built from the original transactions — open any entry to see its source document${
          user.accessView === "GST_ONLY" ? " (GST view)" : ""
        }`}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LEDGER_KINDS.map((kind, index) => (
          <Link key={kind} href={`/ledgers/${kind}`}>
            <Card className="h-full transition-colors hover:border-primary">
              <CardContent className="flex items-start gap-3 p-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BookOpen className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium">{String.fromCharCode(65 + index)}. {LEDGER_META[kind].title}</p>
                  <p className="text-xs text-muted-foreground">{LEDGER_META[kind].description}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
