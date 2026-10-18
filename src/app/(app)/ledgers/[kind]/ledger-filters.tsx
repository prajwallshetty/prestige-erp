"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Download, FileText, Printer, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  kind: string;
  partyLabel: string | null;
  partyOptions: SearchableOption[];
  financialYears: string[];
  initial: { party: string; fy: string; from: string; to: string; q: string };
}

/** URL-driven filter bar + exports. Same params feed the page, PDF and CSV. */
export function LedgerFilters({ kind, partyLabel, partyOptions, financialYears, initial }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState(initial);

  const toParams = (next: typeof state) => {
    const params = new URLSearchParams();
    if (next.party) params.set("party", next.party);
    if (next.fy && next.fy !== "all") params.set("fy", next.fy);
    else {
      if (next.from) params.set("from", next.from);
      if (next.to) params.set("to", next.to);
    }
    if (next.q.trim()) params.set("q", next.q.trim());
    return params;
  };

  const apply = (next: typeof state) => {
    setState(next);
    const qs = toParams(next).toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const exportHref = (format: "pdf" | "csv") => {
    const params = toParams(state);
    params.set("format", format);
    return `/api/ledgers/${kind}?${params.toString()}`;
  };

  return (
    <div className="no-print space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {partyLabel ? (
          <div className="space-y-1.5 lg:col-span-2">
            <Label>{partyLabel}</Label>
            <SearchableSelect
              ariaLabel={partyLabel}
              options={partyOptions}
              value={state.party}
              onValueChange={(party) => apply({ ...state, party })}
              placeholder={`Select ${partyLabel.toLowerCase()}…`}
              emptyMessage="No matches"
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label>Financial year</Label>
          <Select
            value={state.fy || "all"}
            onValueChange={(fy) => apply({ ...state, fy: fy === "all" ? "" : fy, from: "", to: "" })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              {financialYears.map((fy) => <SelectItem key={fy} value={fy}>FY {fy}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lg-from">From</Label>
          <Input id="lg-from" type="date" value={state.from} disabled={Boolean(state.fy)}
            onChange={(e) => apply({ ...state, from: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lg-to">To</Label>
          <Input id="lg-to" type="date" value={state.to} disabled={Boolean(state.fy)}
            onChange={(e) => apply({ ...state, to: e.target.value })} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search particulars or reference…"
            value={state.q}
            onChange={(e) => setState({ ...state, q: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") apply(state); }}
            onBlur={() => { if (state.q !== initial.q) apply(state); }}
          />
        </div>
        {(state.q || state.from || state.to || state.fy) ? (
          <Button variant="ghost" size="sm" onClick={() => apply({ ...state, q: "", from: "", to: "", fy: "" })}>
            <X /> Clear
          </Button>
        ) : null}
        <Button asChild variant="outline" size="sm">
          <a href={exportHref("pdf")} target="_blank" rel="noreferrer"><FileText /> PDF</a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={exportHref("csv")}><Download /> Excel / CSV</a>
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>
    </div>
  );
}
