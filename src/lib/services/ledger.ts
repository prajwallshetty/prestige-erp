import "server-only";

import { prisma } from "@/lib/prisma";
import { num, round2 } from "@/lib/money";
import { NotFoundError } from "@/lib/action-result";
import type { SessionUser } from "@/lib/session";
import { LEDGER_META, type LedgerKind, type LedgerQuery, type LedgerResult, type LedgerRow } from "@/lib/ledger/types";

/**
 * The one accounting engine. Every ledger is a pure projection of the
 * original transaction tables (invoices, payments, returns, purchase bills,
 * expenses, stock movements, journal entries) — nothing is stored twice.
 * The customer / supplier "outstanding" rollups (dashboard, reports, party
 * lists) call `customerBalance` / `supplierBalance` below, which use the very
 * same debit/credit rules as the party ledgers, so they can never disagree.
 *
 *   Customer : Opening + Debits (invoices, refunds, debit adj.)
 *                      − Credits (receipts, returns, credit adj., discounts)
 *   Supplier : Opening + Credits (purchase bills, credit adj.)
 *                      − Debits (payments, returns, debit adj., discounts)
 */

// ---------------------------------------------------------------------------
// Raw entry model
// ---------------------------------------------------------------------------

interface RawEntry {
  date: Date;
  particulars: string;
  reference: string;
  debit: number;
  credit: number;
  href: string | null;
  linkLabel: string | null;
  /** Tie-breaker so same-instant entries keep a stable order. */
  order: number;
}

type Natural = "DR" | "CR";

const CASH_METHODS = ["CASH"] as const;

interface Scope {
  firmId: string;
  gstOnly: boolean;
}

function scopeOf(user: Pick<SessionUser, "activeFirmId" | "accessView">): Scope {
  if (!user.activeFirmId) throw new NotFoundError("Select a firm before opening a ledger");
  return { firmId: user.activeFirmId, gstOnly: user.accessView === "GST_ONLY" };
}

const n = num;

// ---------------------------------------------------------------------------
// Customer ledger
// ---------------------------------------------------------------------------

async function customerEntries(scope: Scope, customerId: string): Promise<{ opening: number; entries: RawEntry[]; name: string }> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, firmId: scope.firmId },
    select: { name: true, code: true, openingBalance: true },
  });
  if (!customer) throw new NotFoundError("Customer not found");
  const gst = scope.gstOnly ? ({ taxMode: "GST" } as const) : {};

  const [invoices, payments, returns, journal] = await Promise.all([
    prisma.invoice.findMany({
      where: { firmId: scope.firmId, customerId, status: { not: "CANCELLED" }, ...gst },
      select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true, kind: true },
    }),
    prisma.payment.findMany({
      where: {
        firmId: scope.firmId,
        customerId,
        direction: { in: ["CUSTOMER_IN", "REFUND_OUT"] },
        ...(scope.gstOnly ? { OR: [{ invoice: { taxMode: "GST" } }, { salesReturn: { taxMode: "GST" } }] } : {}),
      },
      select: { id: true, paymentNumber: true, paidAt: true, amount: true, direction: true, method: true, isAdvance: true },
    }),
    prisma.salesReturn.findMany({
      where: { firmId: scope.firmId, customerId, status: "APPROVED", ...gst },
      select: { id: true, returnNumber: true, createdAt: true, approvedAt: true, totalAmount: true, invoice: { select: { invoiceNumber: true } } },
    }),
    scope.gstOnly
      ? Promise.resolve([])
      : prisma.journalEntry.findMany({
          where: { firmId: scope.firmId, customerId },
          select: { id: true, entryNumber: true, entryDate: true, type: true, amount: true, narration: true },
        }),
  ]);

  const entries: RawEntry[] = [];
  for (const inv of invoices) {
    entries.push({
      date: inv.invoiceDate,
      particulars: `Invoice #${inv.invoiceNumber}`,
      reference: inv.invoiceNumber,
      debit: n(inv.totalAmount),
      credit: 0,
      href: `/invoices/${inv.id}`,
      linkLabel: "Open Invoice",
      order: 1,
    });
  }
  for (const pay of payments) {
    const refund = pay.direction === "REFUND_OUT";
    entries.push({
      date: pay.paidAt,
      particulars: refund
        ? `Refund paid #${pay.paymentNumber} (${pay.method})`
        : `${pay.isAdvance ? "Advance received" : "Payment received"} #${pay.paymentNumber} (${pay.method})`,
      reference: pay.paymentNumber,
      debit: refund ? n(pay.amount) : 0,
      credit: refund ? 0 : n(pay.amount),
      href: `/payments/${pay.id}`,
      linkLabel: "Open Payment Receipt",
      order: 2,
    });
  }
  for (const ret of returns) {
    entries.push({
      date: ret.approvedAt ?? ret.createdAt,
      particulars: `Sales Return #${ret.returnNumber} (credit note, against ${ret.invoice.invoiceNumber})`,
      reference: ret.returnNumber,
      debit: 0,
      credit: n(ret.totalAmount),
      href: `/sales-returns/${ret.id}`,
      linkLabel: "Open Sales Return",
      order: 3,
    });
  }
  for (const j of journal) {
    const debit = j.type === "DEBIT_ADJUSTMENT";
    entries.push({
      date: j.entryDate,
      particulars: `${journalLabel(j.type)} — ${j.narration}`,
      reference: j.entryNumber,
      debit: debit ? n(j.amount) : 0,
      credit: debit ? 0 : n(j.amount),
      href: null,
      linkLabel: null,
      order: 4,
    });
  }
  return { opening: scope.gstOnly ? 0 : n(customer.openingBalance), entries, name: `${customer.name} (${customer.code})` };
}

// ---------------------------------------------------------------------------
// Supplier ledger (natural side = credit / payable)
// ---------------------------------------------------------------------------

async function supplierEntries(scope: Scope, supplierId: string): Promise<{ opening: number; entries: RawEntry[]; name: string }> {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, firmId: scope.firmId },
    select: { name: true, code: true, openingBalance: true },
  });
  if (!supplier) throw new NotFoundError("Supplier not found");
  const gst = scope.gstOnly ? ({ taxMode: "GST" } as const) : {};

  const [bills, payments, returns, journal] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where: { firmId: scope.firmId, supplierId, status: { not: "CANCELLED" }, ...gst },
      select: { id: true, invoiceNumber: true, supplierRef: true, invoiceDate: true, total: true },
    }),
    prisma.supplierPayment.findMany({
      where: { firmId: scope.firmId, supplierId, ...(scope.gstOnly ? { invoice: { taxMode: "GST" } } : {}) },
      select: { id: true, paymentNumber: true, paidAt: true, amount: true, method: true, invoiceId: true },
    }),
    prisma.purchaseReturn.findMany({
      where: { firmId: scope.firmId, supplierId, ...gst },
      select: { id: true, returnNumber: true, returnedAt: true, total: true },
    }),
    scope.gstOnly
      ? Promise.resolve([])
      : prisma.journalEntry.findMany({
          where: { firmId: scope.firmId, supplierId },
          select: { id: true, entryNumber: true, entryDate: true, type: true, amount: true, narration: true },
        }),
  ]);

  const entries: RawEntry[] = [];
  for (const bill of bills) {
    entries.push({
      date: bill.invoiceDate,
      particulars: `Purchase Bill #${bill.invoiceNumber}${bill.supplierRef ? ` (Supplier ref ${bill.supplierRef})` : ""}`,
      reference: bill.invoiceNumber,
      debit: 0,
      credit: n(bill.total),
      href: `/purchases/bills/${bill.id}`,
      linkLabel: "Open Purchase Bill",
      order: 1,
    });
  }
  for (const pay of payments) {
    entries.push({
      date: pay.paidAt,
      particulars: `Payment made #${pay.paymentNumber} (${pay.method})`,
      reference: pay.paymentNumber,
      debit: n(pay.amount),
      credit: 0,
      href: pay.invoiceId ? `/purchases/bills/${pay.invoiceId}` : null,
      linkLabel: pay.invoiceId ? "Open Purchase Bill" : null,
      order: 2,
    });
  }
  for (const ret of returns) {
    entries.push({
      date: ret.returnedAt,
      particulars: `Purchase Return #${ret.returnNumber} (debit note)`,
      reference: ret.returnNumber,
      debit: n(ret.total),
      credit: 0,
      href: `/purchases/returns/${ret.id}`,
      linkLabel: "Open Purchase Return",
      order: 3,
    });
  }
  for (const j of journal) {
    // Supplier: debit adjustments and discounts received reduce the payable.
    const debit = j.type === "DEBIT_ADJUSTMENT" || j.type === "DISCOUNT_RECEIVED";
    entries.push({
      date: j.entryDate,
      particulars: `${journalLabel(j.type)} — ${j.narration}`,
      reference: j.entryNumber,
      debit: debit ? n(j.amount) : 0,
      credit: debit ? 0 : n(j.amount),
      href: null,
      linkLabel: null,
      order: 4,
    });
  }
  return { opening: scope.gstOnly ? 0 : n(supplier.openingBalance), entries, name: `${supplier.name} (${supplier.code})` };
}

function journalLabel(type: string): string {
  switch (type) {
    case "DEBIT_ADJUSTMENT":
      return "Debit adjustment";
    case "CREDIT_ADJUSTMENT":
      return "Credit adjustment";
    case "DISCOUNT_ALLOWED":
      return "Discount allowed";
    case "DISCOUNT_RECEIVED":
      return "Discount received";
    default:
      return type;
  }
}

// ---------------------------------------------------------------------------
// Rollup balances (used by customer/supplier outstanding everywhere)
// ---------------------------------------------------------------------------

/** Signed customer balance: positive = customer owes us. Full (COMBINED) view. */
export async function customerBalance(
  tx: Pick<typeof prisma, "invoice" | "payment" | "salesReturn" | "journalEntry" | "customer">,
  firmId: string,
  customerId: string,
): Promise<number> {
  const [customer, inv, pay, ref, ret, jDr, jCr] = await Promise.all([
    tx.customer.findUnique({ where: { id: customerId }, select: { openingBalance: true } }),
    tx.invoice.aggregate({ where: { firmId, customerId, status: { not: "CANCELLED" } }, _sum: { totalAmount: true } }),
    tx.payment.aggregate({ where: { firmId, customerId, direction: "CUSTOMER_IN" }, _sum: { amount: true } }),
    tx.payment.aggregate({ where: { firmId, customerId, direction: "REFUND_OUT" }, _sum: { amount: true } }),
    tx.salesReturn.aggregate({ where: { firmId, customerId, status: "APPROVED" }, _sum: { totalAmount: true } }),
    tx.journalEntry.aggregate({ where: { firmId, customerId, type: "DEBIT_ADJUSTMENT" }, _sum: { amount: true } }),
    tx.journalEntry.aggregate({
      where: { firmId, customerId, type: { in: ["CREDIT_ADJUSTMENT", "DISCOUNT_ALLOWED"] } },
      _sum: { amount: true },
    }),
  ]);
  const debits = n(inv._sum.totalAmount) + n(ref._sum.amount) + n(jDr._sum.amount);
  const credits = n(pay._sum.amount) + n(ret._sum.totalAmount) + n(jCr._sum.amount);
  return round2(n(customer?.openingBalance) + debits - credits);
}

/** Signed supplier balance: positive = we owe the supplier. */
export async function supplierBalance(
  tx: Pick<typeof prisma, "purchaseInvoice" | "supplierPayment" | "purchaseReturn" | "journalEntry" | "supplier">,
  firmId: string,
  supplierId: string,
): Promise<number> {
  const [supplier, bills, pay, ret, jDr, jCr] = await Promise.all([
    tx.supplier.findUnique({ where: { id: supplierId }, select: { openingBalance: true } }),
    tx.purchaseInvoice.aggregate({ where: { firmId, supplierId, status: { not: "CANCELLED" } }, _sum: { total: true } }),
    tx.supplierPayment.aggregate({ where: { firmId, supplierId }, _sum: { amount: true } }),
    tx.purchaseReturn.aggregate({ where: { firmId, supplierId }, _sum: { total: true } }),
    tx.journalEntry.aggregate({
      where: { firmId, supplierId, type: { in: ["DEBIT_ADJUSTMENT", "DISCOUNT_RECEIVED"] } },
      _sum: { amount: true },
    }),
    tx.journalEntry.aggregate({ where: { firmId, supplierId, type: "CREDIT_ADJUSTMENT" }, _sum: { amount: true } }),
  ]);
  const credits = n(bills._sum.total) + n(jCr._sum.amount);
  const debits = n(pay._sum.amount) + n(ret._sum.total) + n(jDr._sum.amount);
  return round2(n(supplier?.openingBalance) + credits - debits);
}

// ---------------------------------------------------------------------------
// Transaction ledgers
// ---------------------------------------------------------------------------

async function salesEntries(scope: Scope): Promise<RawEntry[]> {
  const invoices = await prisma.invoice.findMany({
    where: { firmId: scope.firmId, status: { not: "CANCELLED" }, ...(scope.gstOnly ? { taxMode: "GST" } : {}) },
    select: { id: true, invoiceNumber: true, invoiceDate: true, taxableAmount: true, billToName: true, taxMode: true },
  });
  return invoices.map((inv) => ({
    date: inv.invoiceDate,
    particulars: `Sale — Invoice #${inv.invoiceNumber} · ${inv.billToName}${inv.taxMode === "GST" ? " (Tax Invoice)" : ""}`,
    reference: inv.invoiceNumber,
    debit: 0,
    credit: n(inv.taxableAmount),
    href: `/invoices/${inv.id}`,
    linkLabel: "Open Invoice",
    order: 1,
  }));
}

async function purchaseEntries(scope: Scope): Promise<RawEntry[]> {
  const bills = await prisma.purchaseInvoice.findMany({
    where: { firmId: scope.firmId, status: { not: "CANCELLED" }, ...(scope.gstOnly ? { taxMode: "GST" } : {}) },
    select: { id: true, invoiceNumber: true, invoiceDate: true, taxableAmount: true, supplier: { select: { name: true } } },
  });
  return bills.map((bill) => ({
    date: bill.invoiceDate,
    particulars: `Purchase — Bill #${bill.invoiceNumber} · ${bill.supplier.name}`,
    reference: bill.invoiceNumber,
    debit: n(bill.taxableAmount),
    credit: 0,
    href: `/purchases/bills/${bill.id}`,
    linkLabel: "Open Purchase",
    order: 1,
  }));
}

/** Cash or bank book: every receipt (debit) and payment (credit) by method. */
async function bookEntries(scope: Scope, book: "cash" | "bank"): Promise<RawEntry[]> {
  const methodFilter =
    book === "cash" ? { in: [...CASH_METHODS] as ("CASH")[] } : { notIn: [...CASH_METHODS] as ("CASH")[] };
  const gstPay = scope.gstOnly
    ? { OR: [{ invoice: { taxMode: "GST" as const } }, { purchaseInvoice: { taxMode: "GST" as const } }, { salesReturn: { taxMode: "GST" as const } }] }
    : {};

  const [payments, supplierPayments, expenses] = await Promise.all([
    prisma.payment.findMany({
      where: { firmId: scope.firmId, method: methodFilter, ...gstPay },
      select: {
        id: true, paymentNumber: true, paidAt: true, amount: true, direction: true, method: true,
        customer: { select: { name: true } }, supplier: { select: { name: true } },
      },
    }),
    prisma.supplierPayment.findMany({
      where: { firmId: scope.firmId, method: methodFilter, ...(scope.gstOnly ? { invoice: { taxMode: "GST" as const } } : {}) },
      select: { id: true, paymentNumber: true, paidAt: true, amount: true, method: true, invoiceId: true, supplier: { select: { name: true } } },
    }),
    scope.gstOnly
      ? Promise.resolve([])
      : prisma.expense.findMany({
          where: { firmId: scope.firmId, paymentMethod: methodFilter, status: { in: ["APPROVED", "PAID"] } },
          select: { id: true, expenseNumber: true, expenseDate: true, amount: true, description: true, paymentMethod: true },
        }),
  ]);

  const entries: RawEntry[] = [];
  for (const p of payments) {
    const receipt = p.direction === "CUSTOMER_IN";
    entries.push({
      date: p.paidAt,
      particulars: receipt
        ? `Receipt from ${p.customer?.name ?? "customer"} (${p.method})`
        : p.direction === "REFUND_OUT"
          ? `Refund to ${p.customer?.name ?? "customer"} (${p.method})`
          : `Payment to ${p.supplier?.name ?? "supplier"} (${p.method})`,
      reference: p.paymentNumber,
      debit: receipt ? n(p.amount) : 0,
      credit: receipt ? 0 : n(p.amount),
      href: `/payments/${p.id}`,
      linkLabel: "Open Payment Receipt",
      order: 1,
    });
  }
  for (const p of supplierPayments) {
    entries.push({
      date: p.paidAt,
      particulars: `Payment to ${p.supplier.name} (${p.method})`,
      reference: p.paymentNumber,
      debit: 0,
      credit: n(p.amount),
      href: p.invoiceId ? `/purchases/bills/${p.invoiceId}` : null,
      linkLabel: p.invoiceId ? "Open Purchase Bill" : null,
      order: 2,
    });
  }
  for (const e of expenses) {
    entries.push({
      date: e.expenseDate,
      particulars: `Expense — ${e.description}`,
      reference: e.expenseNumber,
      debit: 0,
      credit: n(e.amount),
      href: `/expenses/${e.id}`,
      linkLabel: "Open Expense",
      order: 3,
    });
  }
  return entries;
}

async function expenseEntries(scope: Scope): Promise<RawEntry[]> {
  if (scope.gstOnly) return [];
  const expenses = await prisma.expense.findMany({
    where: { firmId: scope.firmId, status: { in: ["APPROVED", "PAID"] } },
    select: { id: true, expenseNumber: true, expenseDate: true, amount: true, description: true, category: true, paidTo: true },
  });
  return expenses.map((e) => ({
    date: e.expenseDate,
    particulars: `${e.category.replace(/_/g, " ")} — ${e.description}${e.paidTo ? ` (${e.paidTo})` : ""}`,
    reference: e.expenseNumber,
    debit: n(e.amount),
    credit: 0,
    href: `/expenses/${e.id}`,
    linkLabel: "Open Expense",
    order: 1,
  }));
}

async function paymentEntries(scope: Scope): Promise<RawEntry[]> {
  const gstPay = scope.gstOnly
    ? { OR: [{ invoice: { taxMode: "GST" as const } }, { purchaseInvoice: { taxMode: "GST" as const } }, { salesReturn: { taxMode: "GST" as const } }] }
    : {};
  const [payments, supplierPayments] = await Promise.all([
    prisma.payment.findMany({
      where: { firmId: scope.firmId, ...gstPay },
      select: {
        id: true, paymentNumber: true, paidAt: true, amount: true, direction: true, method: true,
        customer: { select: { name: true } }, supplier: { select: { name: true } },
      },
    }),
    prisma.supplierPayment.findMany({
      where: { firmId: scope.firmId, ...(scope.gstOnly ? { invoice: { taxMode: "GST" as const } } : {}) },
      select: { id: true, paymentNumber: true, paidAt: true, amount: true, method: true, invoiceId: true, supplier: { select: { name: true } } },
    }),
  ]);
  const entries: RawEntry[] = [];
  for (const p of payments) {
    const receipt = p.direction === "CUSTOMER_IN";
    entries.push({
      date: p.paidAt,
      particulars: receipt
        ? `Receipt — ${p.customer?.name ?? "customer"} (${p.method})`
        : p.direction === "REFUND_OUT"
          ? `Refund — ${p.customer?.name ?? "customer"} (${p.method})`
          : `Payment — ${p.supplier?.name ?? "supplier"} (${p.method})`,
      reference: p.paymentNumber,
      debit: receipt ? n(p.amount) : 0,
      credit: receipt ? 0 : n(p.amount),
      href: `/payments/${p.id}`,
      linkLabel: "Open Payment Receipt",
      order: 1,
    });
  }
  for (const p of supplierPayments) {
    entries.push({
      date: p.paidAt,
      particulars: `Payment — ${p.supplier.name} (${p.method})`,
      reference: p.paymentNumber,
      debit: 0,
      credit: n(p.amount),
      href: p.invoiceId ? `/purchases/bills/${p.invoiceId}` : null,
      linkLabel: p.invoiceId ? "Open Purchase Bill" : null,
      order: 2,
    });
  }
  return entries;
}

async function salesReturnEntries(scope: Scope): Promise<RawEntry[]> {
  const returns = await prisma.salesReturn.findMany({
    where: { firmId: scope.firmId, status: "APPROVED", ...(scope.gstOnly ? { taxMode: "GST" } : {}) },
    select: {
      id: true, returnNumber: true, approvedAt: true, createdAt: true, totalAmount: true,
      customer: { select: { name: true } }, invoice: { select: { invoiceNumber: true } },
    },
  });
  return returns.map((r) => ({
    date: r.approvedAt ?? r.createdAt,
    particulars: `Sales Return #${r.returnNumber} · ${r.customer.name} (Invoice ${r.invoice.invoiceNumber})`,
    reference: r.returnNumber,
    debit: n(r.totalAmount),
    credit: 0,
    href: `/sales-returns/${r.id}`,
    linkLabel: "Open Sales Return",
    order: 1,
  }));
}

async function purchaseReturnEntries(scope: Scope): Promise<RawEntry[]> {
  const returns = await prisma.purchaseReturn.findMany({
    where: { firmId: scope.firmId, ...(scope.gstOnly ? { taxMode: "GST" } : {}) },
    select: { id: true, returnNumber: true, returnedAt: true, total: true, supplier: { select: { name: true } } },
  });
  return returns.map((r) => ({
    date: r.returnedAt,
    particulars: `Purchase Return #${r.returnNumber} · ${r.supplier.name}`,
    reference: r.returnNumber,
    debit: 0,
    credit: n(r.total),
    href: `/purchases/returns/${r.id}`,
    linkLabel: "Open Purchase Return",
    order: 1,
  }));
}

async function discountEntries(scope: Scope): Promise<RawEntry[]> {
  const gst = scope.gstOnly ? ({ taxMode: "GST" } as const) : {};
  const [invoices, bills, journal] = await Promise.all([
    prisma.invoice.findMany({
      where: { firmId: scope.firmId, status: { not: "CANCELLED" }, discountAmount: { gt: 0 }, ...gst },
      select: { id: true, invoiceNumber: true, invoiceDate: true, discountAmount: true, billToName: true },
    }),
    prisma.purchaseInvoice.findMany({
      where: { firmId: scope.firmId, status: { not: "CANCELLED" }, discountAmount: { gt: 0 }, ...gst },
      select: { id: true, invoiceNumber: true, invoiceDate: true, discountAmount: true, supplier: { select: { name: true } } },
    }),
    scope.gstOnly
      ? Promise.resolve([])
      : prisma.journalEntry.findMany({
          where: { firmId: scope.firmId, type: { in: ["DISCOUNT_ALLOWED", "DISCOUNT_RECEIVED"] } },
          select: { id: true, entryNumber: true, entryDate: true, type: true, amount: true, narration: true },
        }),
  ]);
  const entries: RawEntry[] = [];
  for (const i of invoices) {
    entries.push({
      date: i.invoiceDate, particulars: `Discount allowed — Invoice #${i.invoiceNumber} · ${i.billToName}`,
      reference: i.invoiceNumber, debit: n(i.discountAmount), credit: 0,
      href: `/invoices/${i.id}`, linkLabel: "Open Invoice", order: 1,
    });
  }
  for (const b of bills) {
    entries.push({
      date: b.invoiceDate, particulars: `Discount received — Bill #${b.invoiceNumber} · ${b.supplier.name}`,
      reference: b.invoiceNumber, debit: 0, credit: n(b.discountAmount),
      href: `/purchases/bills/${b.id}`, linkLabel: "Open Purchase Bill", order: 2,
    });
  }
  for (const j of journal) {
    const allowed = j.type === "DISCOUNT_ALLOWED";
    entries.push({
      date: j.entryDate, particulars: `${journalLabel(j.type)} — ${j.narration}`,
      reference: j.entryNumber, debit: allowed ? n(j.amount) : 0, credit: allowed ? 0 : n(j.amount),
      href: null, linkLabel: null, order: 3,
    });
  }
  return entries;
}

async function gstEntries(scope: Scope): Promise<RawEntry[]> {
  const [invoices, bills] = await Promise.all([
    prisma.invoice.findMany({
      where: { firmId: scope.firmId, taxMode: "GST", status: { not: "CANCELLED" } },
      select: { id: true, invoiceNumber: true, invoiceDate: true, cgstAmount: true, sgstAmount: true, igstAmount: true, billToName: true },
    }),
    prisma.purchaseInvoice.findMany({
      where: { firmId: scope.firmId, taxMode: "GST", status: { not: "CANCELLED" } },
      select: { id: true, invoiceNumber: true, invoiceDate: true, cgstAmount: true, sgstAmount: true, igstAmount: true, supplier: { select: { name: true } } },
    }),
  ]);
  const entries: RawEntry[] = [];
  for (const i of invoices) {
    const tax = n(i.cgstAmount) + n(i.sgstAmount) + n(i.igstAmount);
    if (tax === 0) continue;
    entries.push({
      date: i.invoiceDate,
      particulars: `Output tax — Invoice #${i.invoiceNumber} · ${i.billToName} (CGST ${n(i.cgstAmount).toFixed(2)} / SGST ${n(i.sgstAmount).toFixed(2)} / IGST ${n(i.igstAmount).toFixed(2)})`,
      reference: i.invoiceNumber, debit: 0, credit: round2(tax),
      href: `/invoices/${i.id}`, linkLabel: "Open Invoice", order: 1,
    });
  }
  for (const b of bills) {
    const tax = n(b.cgstAmount) + n(b.sgstAmount) + n(b.igstAmount);
    if (tax === 0) continue;
    entries.push({
      date: b.invoiceDate,
      particulars: `Input tax — Bill #${b.invoiceNumber} · ${b.supplier.name} (CGST ${n(b.cgstAmount).toFixed(2)} / SGST ${n(b.sgstAmount).toFixed(2)} / IGST ${n(b.igstAmount).toFixed(2)})`,
      reference: b.invoiceNumber, debit: round2(tax), credit: 0,
      href: `/purchases/bills/${b.id}`, linkLabel: "Open Purchase Bill", order: 2,
    });
  }
  return entries;
}

const STOCK_DOC_LINKS: Record<string, { href: (id: string) => string | null; label: string; text: string }> = {
  INVOICE: { href: (id) => `/invoices/${id}`, label: "Open Invoice", text: "Sale" },
  INVOICE_CANCEL: { href: (id) => `/invoices/${id}`, label: "Open Invoice", text: "Cancelled sale" },
  PURCHASE_INVOICE: { href: (id) => `/purchases/bills/${id}`, label: "Open Purchase Bill", text: "Purchase" },
  PURCHASE_RETURN: { href: (id) => `/purchases/returns/${id}`, label: "Open Purchase Return", text: "Purchase return" },
  SALES_RETURN: { href: (id) => `/sales-returns/${id}`, label: "Open Sales Return", text: "Sales return" },
  STOCK_ADJUSTMENT: { href: () => `/inventory/adjustments`, label: "Open Adjustments", text: "Stock adjustment" },
  STOCK_TRANSFER: { href: () => `/inventory/transfers`, label: "Open Transfers", text: "Stock transfer" },
};

async function stockEntries(scope: Scope, productId: string | null): Promise<{ entries: RawEntry[]; name: string | null }> {
  let name: string | null = null;
  if (productId) {
    const product = await prisma.product.findFirst({
      where: { id: productId, firmId: scope.firmId },
      select: { name: true, subName: true, sku: true },
    });
    if (!product) throw new NotFoundError("Product not found");
    name = `${product.name}${product.subName ? ` — ${product.subName}` : ""} (${product.sku})`;
  }
  const txns = await prisma.stockTransaction.findMany({
    where: { firmId: scope.firmId, ...(productId ? { productId } : {}) },
    select: {
      id: true, createdAt: true, type: true, quantity: true, reference: true, documentType: true, documentId: true,
      product: { select: { name: true, subName: true } }, branch: { select: { name: true } },
    },
    take: 20000,
  });

  let allowedDocs: Set<string> | null = null;
  if (scope.gstOnly) {
    const invoiceIds = txns.filter((t) => t.documentType?.startsWith("INVOICE") && t.documentId).map((t) => t.documentId!);
    const billIds = txns.filter((t) => t.documentType === "PURCHASE_INVOICE" && t.documentId).map((t) => t.documentId!);
    const [inv, bills] = await Promise.all([
      prisma.invoice.findMany({ where: { id: { in: invoiceIds }, taxMode: "GST" }, select: { id: true } }),
      prisma.purchaseInvoice.findMany({ where: { id: { in: billIds }, taxMode: "GST" }, select: { id: true } }),
    ]);
    allowedDocs = new Set([...inv.map((i) => i.id), ...bills.map((b) => b.id)]);
  }

  const entries: RawEntry[] = [];
  for (const t of txns) {
    if (allowedDocs && !(t.documentId && allowedDocs.has(t.documentId))) continue;
    const link = t.documentType ? STOCK_DOC_LINKS[t.documentType] : undefined;
    const label = link?.text ?? t.type.replace(/_/g, " ").toLowerCase();
    entries.push({
      date: t.createdAt,
      particulars: `${label}${t.reference ? ` #${t.reference}` : ""}${productId ? "" : ` · ${t.product.name}${t.product.subName ? ` ${t.product.subName}` : ""}`} (${t.branch.name})`,
      reference: t.reference ?? "",
      debit: t.quantity > 0 ? t.quantity : 0,
      credit: t.quantity < 0 ? -t.quantity : 0,
      href: link && t.documentId ? link.href(t.documentId) : null,
      linkLabel: link && t.documentId ? link.label : null,
      order: 1,
    });
  }
  return { entries, name };
}

async function journalEntries(scope: Scope): Promise<RawEntry[]> {
  if (scope.gstOnly) return [];
  const rows = await prisma.journalEntry.findMany({
    where: { firmId: scope.firmId },
    select: {
      id: true, entryNumber: true, entryDate: true, type: true, amount: true, narration: true,
      customer: { select: { name: true } }, supplier: { select: { name: true } },
    },
  });
  return rows.map((j) => {
    const debit = j.type === "DEBIT_ADJUSTMENT" || j.type === "DISCOUNT_ALLOWED";
    const party = j.customer?.name ?? j.supplier?.name;
    return {
      date: j.entryDate,
      particulars: `${journalLabel(j.type)}${party ? ` · ${party}` : ""} — ${j.narration}`,
      reference: j.entryNumber,
      debit: debit ? n(j.amount) : 0,
      credit: debit ? 0 : n(j.amount),
      href: null,
      linkLabel: null,
      order: 1,
    };
  });
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const NATURAL: Record<LedgerKind, Natural> = {
  customer: "DR",
  supplier: "CR",
  sales: "CR",
  purchase: "DR",
  cash: "DR",
  bank: "DR",
  expense: "DR",
  payments: "DR",
  "sales-return": "DR",
  "purchase-return": "CR",
  discount: "DR",
  gst: "CR",
  stock: "DR",
  journal: "DR",
};

function sideOf(balance: number, natural: Natural): "Dr" | "Cr" {
  const debitSide = natural === "DR" ? balance >= 0 : balance < 0;
  return debitSide ? "Dr" : "Cr";
}

/**
 * Builds a ledger. Rows before `from` collapse into a carried-forward
 * "Opening Balance"; the running balance then follows the ledger's natural
 * side (receivable for customers, payable for suppliers, …).
 */
export async function buildLedger(
  user: Pick<SessionUser, "activeFirmId" | "accessView">,
  query: LedgerQuery,
): Promise<LedgerResult> {
  const scope = scopeOf(user);
  const meta = LEDGER_META[query.kind];
  const natural = NATURAL[query.kind];

  let opening = 0;
  let raw: RawEntry[] = [];
  let subject: string | null = null;

  switch (query.kind) {
    case "customer": {
      if (!query.partyId) throw new NotFoundError("Select a customer");
      const r = await customerEntries(scope, query.partyId);
      opening = r.opening; raw = r.entries; subject = r.name;
      break;
    }
    case "supplier": {
      if (!query.partyId) throw new NotFoundError("Select a supplier");
      const r = await supplierEntries(scope, query.partyId);
      opening = r.opening; raw = r.entries; subject = r.name;
      break;
    }
    case "sales": raw = await salesEntries(scope); break;
    case "purchase": raw = await purchaseEntries(scope); break;
    case "cash": raw = await bookEntries(scope, "cash"); break;
    case "bank": raw = await bookEntries(scope, "bank"); break;
    case "expense": raw = await expenseEntries(scope); break;
    case "payments": raw = await paymentEntries(scope); break;
    case "sales-return": raw = await salesReturnEntries(scope); break;
    case "purchase-return": raw = await purchaseReturnEntries(scope); break;
    case "discount": raw = await discountEntries(scope); break;
    case "gst": raw = await gstEntries(scope); break;
    case "stock": {
      const r = await stockEntries(scope, query.partyId ?? null);
      raw = r.entries; subject = r.name;
      break;
    }
    case "journal": raw = await journalEntries(scope); break;
  }

  raw.sort((a, b) => a.date.getTime() - b.date.getTime() || a.order - b.order);

  // The party "opening balance" is stored as the natural-side amount.
  // balance = natural-side signed value.
  const signed = (e: { debit: number; credit: number }) => (natural === "DR" ? e.debit - e.credit : e.credit - e.debit);

  const from = query.from ?? null;
  const to = query.to ?? null;
  let carried = opening;
  const inRange: RawEntry[] = [];
  for (const entry of raw) {
    if (from && entry.date < from) {
      carried += signed(entry);
    } else if (to && entry.date > to) {
      continue;
    } else {
      inRange.push(entry);
    }
  }
  carried = round2(carried);

  const search = query.search?.trim().toLowerCase();
  const filtered = search
    ? inRange.filter((e) => e.particulars.toLowerCase().includes(search) || e.reference.toLowerCase().includes(search))
    : inRange;

  const rows: LedgerRow[] = [];
  let running = carried;
  rows.push({
    key: "opening",
    date: from ? from.toISOString() : null,
    particulars: "Opening Balance",
    reference: "",
    debit: 0,
    credit: 0,
    balance: running,
    side: sideOf(running, natural),
    href: null,
    linkLabel: null,
    isOpening: true,
  });

  let totalDebit = 0;
  let totalCredit = 0;
  filtered.forEach((entry, index) => {
    running = round2(running + signed(entry));
    totalDebit += entry.debit;
    totalCredit += entry.credit;
    rows.push({
      key: `${index}-${entry.reference}`,
      date: entry.date.toISOString(),
      particulars: entry.particulars,
      reference: entry.reference,
      debit: entry.debit,
      credit: entry.credit,
      balance: running,
      side: sideOf(running, natural),
      href: entry.href,
      linkLabel: entry.linkLabel,
    });
  });

  // When searching, the closing balance of the filtered view is not the
  // ledger's closing balance — recompute from the unfiltered range.
  let closing = running;
  if (search) {
    closing = round2(carried + inRange.reduce((sum, e) => sum + signed(e), 0));
  }

  return {
    kind: query.kind,
    title: meta.title,
    subject,
    from: from ? from.toISOString() : null,
    to: to ? to.toISOString() : null,
    rows,
    openingBalance: carried,
    openingSide: sideOf(carried, natural),
    totalDebit: round2(totalDebit),
    totalCredit: round2(totalCredit),
    closingBalance: closing,
    closingSide: sideOf(closing, natural),
    unit: query.kind === "stock" ? "qty" : "amount",
    debitLabel: meta.debitLabel,
    creditLabel: meta.creditLabel,
  };
}

/** Option lists for the ledger filter bar. */
export async function ledgerPartyOptions(firmId: string, kind: "customer" | "supplier" | "stock") {
  if (kind === "customer") {
    const rows = await prisma.customer.findMany({ where: { firmId }, select: { id: true, name: true, phone: true, code: true }, orderBy: { name: "asc" } });
    return rows.map((r) => ({ value: r.id, label: r.name, hint: `${r.code} · ${r.phone}` }));
  }
  if (kind === "supplier") {
    const rows = await prisma.supplier.findMany({ where: { firmId }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } });
    return rows.map((r) => ({ value: r.id, label: r.name, hint: r.code }));
  }
  const rows = await prisma.product.findMany({
    where: { firmId }, select: { id: true, name: true, subName: true, sku: true }, orderBy: { name: "asc" }, take: 1000,
  });
  return rows.map((r) => ({ value: r.id, label: r.name + (r.subName ? ` — ${r.subName}` : ""), hint: r.sku }));
}
