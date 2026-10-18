/**
 * Ledger shapes shared by the server service, the pages and the exporters.
 * No server-only imports — safe to use from client components.
 */

export const LEDGER_KINDS = [
  "customer",
  "supplier",
  "sales",
  "purchase",
  "cash",
  "bank",
  "expense",
  "payments",
  "sales-return",
  "purchase-return",
  "discount",
  "gst",
  "stock",
  "journal",
] as const;

export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const LEDGER_META: Record<
  LedgerKind,
  { title: string; description: string; debitLabel: string; creditLabel: string; party?: "customer" | "supplier" }
> = {
  customer: {
    title: "Customer Ledger",
    description: "Invoices, receipts, returns and adjustments per customer",
    debitLabel: "Debit",
    creditLabel: "Credit",
    party: "customer",
  },
  supplier: {
    title: "Supplier Ledger",
    description: "Purchase bills, payments, returns and adjustments per supplier",
    debitLabel: "Debit",
    creditLabel: "Credit",
    party: "supplier",
  },
  sales: {
    title: "Sales Ledger",
    description: "Every sales invoice (value before tax)",
    debitLabel: "Debit",
    creditLabel: "Credit",
  },
  purchase: {
    title: "Purchase Ledger",
    description: "Every supplier bill (value before tax)",
    debitLabel: "Debit",
    creditLabel: "Credit",
  },
  cash: {
    title: "Cash Ledger",
    description: "All cash receipts and payments",
    debitLabel: "Receipts",
    creditLabel: "Payments",
  },
  bank: {
    title: "Bank Ledger",
    description: "All UPI / card / bank / cheque receipts and payments",
    debitLabel: "Receipts",
    creditLabel: "Payments",
  },
  expense: {
    title: "Expense Ledger",
    description: "Approved and paid expenses",
    debitLabel: "Debit",
    creditLabel: "Credit",
  },
  payments: {
    title: "Payment / Receipt Ledger",
    description: "Customer receipts, supplier payments and refunds",
    debitLabel: "Received",
    creditLabel: "Paid",
  },
  "sales-return": {
    title: "Sales Return Ledger",
    description: "Approved customer returns (credit notes)",
    debitLabel: "Debit",
    creditLabel: "Credit",
  },
  "purchase-return": {
    title: "Purchase Return Ledger",
    description: "Goods returned to suppliers (debit notes)",
    debitLabel: "Debit",
    creditLabel: "Credit",
  },
  discount: {
    title: "Discount Ledger",
    description: "Discounts allowed to customers and received from suppliers",
    debitLabel: "Allowed",
    creditLabel: "Received",
  },
  gst: {
    title: "GST / Tax Ledger",
    description: "Output tax on sales and input tax on purchases",
    debitLabel: "Input tax",
    creditLabel: "Output tax",
  },
  stock: {
    title: "Stock / Inventory Ledger",
    description: "Every stock movement, in units",
    debitLabel: "In",
    creditLabel: "Out",
  },
  journal: {
    title: "General Journal / Adjustment Ledger",
    description: "Manual debit/credit adjustments and discounts",
    debitLabel: "Debit",
    creditLabel: "Credit",
  },
};

export interface LedgerRow {
  key: string;
  /** ISO string — null for the synthetic opening row. */
  date: string | null;
  particulars: string;
  reference: string;
  debit: number;
  credit: number;
  /** Running balance, always positive-or-negative on the ledger's natural side. */
  balance: number;
  /** Side the balance sits on after this row. */
  side: "Dr" | "Cr";
  /** Original document this row came from, when one exists. */
  href: string | null;
  /** Label for the "open source document" link, e.g. "Open Invoice". */
  linkLabel: string | null;
  isOpening?: boolean;
}

export interface LedgerResult {
  kind: LedgerKind;
  title: string;
  /** Selected customer / supplier / product, when the ledger is per-party. */
  subject: string | null;
  from: string | null;
  to: string | null;
  rows: LedgerRow[];
  openingBalance: number;
  openingSide: "Dr" | "Cr";
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  closingSide: "Dr" | "Cr";
  /** Unit label for the amounts: rupees, or units for the stock ledger. */
  unit: "amount" | "qty";
  debitLabel: string;
  creditLabel: string;
}

export interface LedgerQuery {
  kind: LedgerKind;
  /** Customer / supplier id (party ledgers) or product id (stock ledger). */
  partyId?: string | null;
  from?: Date | null;
  to?: Date | null;
  search?: string | null;
}

/** Indian financial year ("2026-27") → date range, April 1 to March 31. */
export function financialYearRange(fy: string): { from: Date; to: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!match) return null;
  const start = Number(match[1]);
  return {
    from: new Date(start, 3, 1, 0, 0, 0, 0),
    to: new Date(start + 1, 2, 31, 23, 59, 59, 999),
  };
}

/** The last few financial years, newest first, e.g. ["2026-27", "2025-26", …]. */
export function recentFinancialYears(count = 6, now: Date = new Date()): string[] {
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: count }, (_, i) => {
    const y = startYear - i;
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  });
}

export function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function ledgerToCsv(ledger: LedgerResult): string {
  const header = ["Date", "Particulars", "Reference", ledger.debitLabel, ledger.creditLabel, "Balance"];
  const lines = [
    [ledger.title + (ledger.subject ? ` — ${ledger.subject}` : "")],
    [`Period: ${ledger.from ? ledger.from.slice(0, 10) : "start"} to ${ledger.to ? ledger.to.slice(0, 10) : "today"}`],
    [],
    header,
    ...ledger.rows.map((row) => [
      row.date ? row.date.slice(0, 10) : "",
      row.particulars,
      row.reference,
      row.debit ? row.debit.toFixed(2) : "",
      row.credit ? row.credit.toFixed(2) : "",
      `${Math.abs(row.balance).toFixed(2)} ${row.side}`,
    ]),
    ["", "Totals", "", ledger.totalDebit.toFixed(2), ledger.totalCredit.toFixed(2), ""],
    ["", "Closing Balance", "", "", "", `${Math.abs(ledger.closingBalance).toFixed(2)} ${ledger.closingSide}`],
  ];
  return lines.map((line) => line.map(csvEscape).join(",")).join("\r\n");
}
