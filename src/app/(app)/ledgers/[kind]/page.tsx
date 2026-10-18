import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermissionInFirm, hasPermission } from "@/lib/session";
import { buildLedger, ledgerPartyOptions } from "@/lib/services/ledger";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { parseLedgerParams } from "@/lib/ledger/params";
import { LEDGER_KINDS, LEDGER_META, recentFinancialYears, type LedgerKind } from "@/lib/ledger/types";
import { LedgerFilters } from "./ledger-filters";
import { JournalEntryDialog } from "./journal-dialog";

export const metadata = { title: "Ledger — Technic Technologies" };

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermissionInFirm(["reports.view", "payments.view"]);
  const { kind } = await params;
  if (!(LEDGER_KINDS as readonly string[]).includes(kind)) notFound();
  const ledgerKind = kind as LedgerKind;
  const meta = LEDGER_META[ledgerKind];
  const sp = await searchParams;
  const query = parseLedgerParams(ledgerKind, sp);
  const one = (key: string) => {
    const v = sp[key];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };

  const needsParty = meta.party !== undefined;
  const partyKind = meta.party ?? (ledgerKind === "stock" ? "stock" : null);
  const [partyOptions, ledger] = await Promise.all([
    partyKind ? ledgerPartyOptions(user.activeFirmId, partyKind) : Promise.resolve([]),
    needsParty && !query.partyId ? Promise.resolve(null) : buildLedger(user, query),
  ]);

  const canPost = hasPermission(user, "payments.create") && user.accessView !== "GST_ONLY";
  const fmt = (v: number) => (ledger?.unit === "qty" ? String(v) : formatCurrency(v));
  const partyLabel = meta.party === "customer" ? "Customer" : meta.party === "supplier" ? "Supplier" : ledgerKind === "stock" ? "Product" : null;

  const [customerOpts, supplierOpts] = canPost && (ledgerKind === "journal" || meta.party)
    ? await Promise.all([
        meta.party === "customer" || ledgerKind === "journal" ? ledgerPartyOptions(user.activeFirmId, "customer") : Promise.resolve([]),
        meta.party === "supplier" || ledgerKind === "journal" ? ledgerPartyOptions(user.activeFirmId, "supplier") : Promise.resolve([]),
      ])
    : [[], []];

  return (
    <div className="space-y-4">
      <PageHeader
        title={meta.title}
        description={ledger?.subject ? `${ledger.subject} · ${meta.description}` : meta.description}
        backButton={
          <Button asChild variant="ghost" size="sm" className="no-print">
            <Link href="/ledgers"><ArrowLeft className="mr-2 h-4 w-4" /> All ledgers</Link>
          </Button>
        }
        actions={
          canPost && (ledgerKind === "journal" || meta.party) ? (
            <JournalEntryDialog
              customers={customerOpts}
              suppliers={supplierOpts}
              defaultCustomerId={meta.party === "customer" ? query.partyId ?? undefined : undefined}
              defaultSupplierId={meta.party === "supplier" ? query.partyId ?? undefined : undefined}
            />
          ) : null
        }
      />

      <LedgerFilters
        kind={ledgerKind}
        partyLabel={partyLabel}
        partyOptions={partyOptions}
        financialYears={recentFinancialYears()}
        initial={{ party: one("party"), fy: one("fy"), from: one("from"), to: one("to"), q: one("q") }}
      />

      {user.accessView === "GST_ONLY" ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          GST view: only tax documents are included in this ledger.
        </p>
      ) : null}

      {!ledger ? (
        <EmptyState title={`Select a ${partyLabel?.toLowerCase()}`} description={`Choose a ${partyLabel?.toLowerCase()} above to see the full ledger.`} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Opening balance" value={`${fmt(Math.abs(ledger.openingBalance))} ${ledger.openingSide}`} animate={false} />
            <StatCard label={`Total ${ledger.debitLabel.toLowerCase()}`} value={fmt(ledger.totalDebit)} animate={false} />
            <StatCard label={`Total ${ledger.creditLabel.toLowerCase()}`} value={fmt(ledger.totalCredit)} animate={false} />
            <StatCard label="Closing balance" value={`${fmt(Math.abs(ledger.closingBalance))} ${ledger.closingSide}`} tone="info" animate={false} />
          </div>

          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead>Particulars</TableHead>
                    <TableHead>Reference No.</TableHead>
                    <TableHead className="text-right">{ledger.debitLabel}</TableHead>
                    <TableHead className="text-right">{ledger.creditLabel}</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="no-print w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.rows.map((row) => (
                    <TableRow key={row.key} className={row.isOpening ? "bg-muted/50 font-medium" : undefined}>
                      <TableCell className="whitespace-nowrap">{row.date ? formatDate(row.date) : "—"}</TableCell>
                      <TableCell className="max-w-md">
                        {row.href ? (
                          <Link href={row.href} className="hover:text-primary hover:underline">{row.particulars}</Link>
                        ) : row.particulars}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{row.reference || "—"}</TableCell>
                      <TableCell className="numeric text-right">{row.debit ? fmt(row.debit) : ""}</TableCell>
                      <TableCell className="numeric text-right">{row.credit ? fmt(row.credit) : ""}</TableCell>
                      <TableCell className="numeric whitespace-nowrap text-right font-medium">
                        {fmt(Math.abs(row.balance))} {row.side}
                      </TableCell>
                      <TableCell className="no-print">
                        {row.href ? (
                          <Button asChild variant="ghost" size="icon-sm" title={row.linkLabel ?? "Open"}>
                            <Link href={row.href} aria-label={row.linkLabel ?? "Open source document"}><ExternalLink /></Link>
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell />
                    <TableCell>Closing Balance</TableCell>
                    <TableCell />
                    <TableCell className="numeric text-right">{fmt(ledger.totalDebit)}</TableCell>
                    <TableCell className="numeric text-right">{fmt(ledger.totalCredit)}</TableCell>
                    <TableCell className="numeric whitespace-nowrap text-right">{fmt(Math.abs(ledger.closingBalance))} {ledger.closingSide}</TableCell>
                    <TableCell className="no-print" />
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
