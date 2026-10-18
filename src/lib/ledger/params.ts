import { financialYearRange, type LedgerKind, type LedgerQuery } from "./types";

/**
 * URL params → ledger query. A financial-year filter sets the date range
 * (and wins over loose from/to); everything else is optional.
 */
export function parseLedgerParams(
  kind: LedgerKind,
  params: Record<string, string | string[] | undefined>,
): LedgerQuery {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };

  let from: Date | null = null;
  let to: Date | null = null;
  const fy = one("fy");
  const range = fy ? financialYearRange(fy) : null;
  if (range) {
    from = range.from;
    to = range.to;
  } else {
    const f = one("from");
    const t = one("to");
    if (f && !Number.isNaN(Date.parse(f))) from = new Date(`${f}T00:00:00`);
    if (t && !Number.isNaN(Date.parse(t))) to = new Date(`${t}T23:59:59.999`);
  }

  return { kind, partyId: one("party") ?? null, from, to, search: one("q") ?? null };
}
