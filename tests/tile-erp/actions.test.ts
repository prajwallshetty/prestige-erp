/**
 * Server-side permission enforcement, exercised through the REAL server actions
 * (session resolution, authorize(), record scoping, services, database). Only
 * the auth session source and next/cache are stubbed (tests/support/mock-next.mjs).
 *
 *   TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/tile_test npm run test:tile-erp
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const REAL_PG = Boolean(process.env.TEST_DATABASE_URL);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tile-erp-actions-"));
const g = globalThis as { __testSession?: unknown };

describe("server actions enforce permissions and record access", { timeout: 300_000 }, () => {
  let prisma: typeof import("../../src/lib/prisma").prisma;
  let rbac: typeof import("../../src/lib/rbac");
  let sales: typeof import("../../src/lib/services/sales");
  let leadsSvc: typeof import("../../src/lib/services/leads");
  let qa: typeof import("../../src/app/(app)/quotations/actions");
  let convert: typeof import("../../src/app/(app)/quotations/[id]/convert/actions");
  let leadActions: typeof import("../../src/app/(app)/leads/actions");
  let mkt: typeof import("../../src/app/(app)/marketing/actions");
  let settingsActions: typeof import("../../src/app/(app)/settings/actions");

  const run = Date.now().toString(36);
  const firmId = `afirm_${run}`;
  const ids = { branch: "", product: "", customer: "" };
  const u: Record<string, { id: string; role: string }> = {};

  const as = (key: string, extra: string[] = [], remove: string[] = []) => {
    const user = u[key];
    const perms = new Set<string>(rbac.ROLE_PERMISSIONS[user.role as keyof typeof rbac.ROLE_PERMISSIONS]);
    extra.forEach((p) => perms.add(p));
    remove.forEach((p) => perms.delete(p));
    g.__testSession = {
      user: {
        id: user.id, name: key, email: `${key}@t.local`, role: user.role, branchId: ids.branch, branchName: "B", branchCode: "B",
        employeeCode: null, permissions: [...perms], firmId, firmName: "F", activeFirmId: firmId, activeFirmName: "F", accessView: "COMBINED",
      },
    };
  };

  before(async () => {
    if (REAL_PG) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    else {
      delete process.env.DATABASE_URL;
      process.env.PGLITE_DIR = dir;
    }
    if (REAL_PG) assert.match(new URL(process.env.DATABASE_URL!).pathname, /test/i);
    ({ prisma } = await import("../../src/lib/prisma"));
    rbac = await import("../../src/lib/rbac");
    sales = await import("../../src/lib/services/sales");
    leadsSvc = await import("../../src/lib/services/leads");
    qa = await import("../../src/app/(app)/quotations/actions");
    convert = await import("../../src/app/(app)/quotations/[id]/convert/actions");
    leadActions = await import("../../src/app/(app)/leads/actions");
    mkt = await import("../../src/app/(app)/marketing/actions");
    settingsActions = await import("../../src/app/(app)/settings/actions");

    const code = `A${run}`.toUpperCase().slice(0, 10);
    await prisma.firm.create({ data: { id: firmId, code, quotationPrefix: code, invoicePrefix: code, name: "Act Co", state: "Karnataka" } });
    ids.branch = (await prisma.branch.create({ data: { firmId, code: "B1", name: "Main", type: "HEAD_OFFICE", state: "Karnataka" } })).id;
    let n = 0;
    for (const [key, role] of [["manager", "MANAGER"], ["salesA", "SALES_STAFF"], ["salesB", "SALES_STAFF"], ["marketing", "MARKETING"], ["admin", "ADMIN"], ["viewer", "VIEWER"]] as const) {
      n += 1;
      const row = await prisma.user.create({ data: { firmId, branchId: ids.branch, name: key, email: `${key}-${run}@t.local`, accessCode: `${run}${n}`.slice(-9).padStart(9, "8"), role } });
      u[key] = { id: row.id, role };
    }
    ids.product = (await prisma.product.create({ data: { firmId, sku: "P1", name: "Tile", sellingPrice: 100, gstRate: 18, unit: "box" } })).id;
    const inv = await import("../../src/lib/services/inventory");
    await inv.writeStockTransaction(prisma, { firmId, branchId: ids.branch, productId: ids.product, type: "OPENING", quantity: 1000 });
    ids.customer = (await prisma.customer.create({ data: { firmId, branchId: ids.branch, code: "C1", name: "Cust", phone: "9000000001" } })).id;
  });

  after(async () => {
    g.__testSession = undefined;
    await prisma?.$disconnect().catch(() => {});
    await (globalThis as { pgliteInstance?: { close(): Promise<void> } }).pgliteInstance?.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const line = () => ({ productId: ids.product, quantity: 2, unitPrice: 100, gstRate: 18 });
  let quoteId = "";

  it("rejects every action when there is no session", async () => {
    g.__testSession = undefined;
    const r = await qa.createQuotationAction({ customerId: ids.customer, taxMode: "NON_GST", lines: [line()] });
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /sign in again|expired/i);
  });

  it("sales staff creates a quotation through the action; it records creator and salesperson", async () => {
    as("salesA");
    const r = await qa.createQuotationAction({ customerId: ids.customer, taxMode: "NON_GST", lines: [line()] });
    assert.equal(r.ok, true, JSON.stringify(r));
    quoteId = (r as { data: { id: string } }).data.id;
    const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quoteId } });
    assert.equal(q.createdById, u.salesA.id);
    assert.equal(q.assignedToId, u.salesA.id);
    // Cannot hand it to someone else without leads.assign.
    const r2 = await qa.createQuotationAction({ customerId: ids.customer, taxMode: "NON_GST", assignedToId: u.salesB.id, lines: [line()] });
    assert.equal(r2.ok, true);
    assert.equal((await prisma.quotation.findUniqueOrThrow({ where: { id: (r2 as { data: { id: string } }).data.id } })).assignedToId, u.salesA.id);
  });

  it("sales staff CANNOT convert a quotation (server-side), even their own", async () => {
    as("salesA");
    const r = await convert.convertQuotationAction({ quotationId: quoteId });
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /permission/i);
    assert.equal(await prisma.invoice.count({ where: { quotationId: quoteId } }), 0);
    assert.equal((await prisma.quotation.findUniqueOrThrow({ where: { id: quoteId } })).status, "DRAFT");
  });

  it("other salespeople cannot see, edit, delete, share or convert it", async () => {
    as("salesB", ["quotation.convert"]); // even with the convert permission, record access still applies
    const upd = await qa.updateQuotationAction({ quotationId: quoteId, customerId: ids.customer, taxMode: "NON_GST", lines: [line()] });
    assert.equal(upd.ok, false);
    assert.match((upd as { error: string }).error, /not found/i);
    assert.equal((await qa.deleteQuotationAction({ quotationId: quoteId })).ok, false);
    assert.equal((await qa.markQuotationSharedAction({ quotationId: quoteId, via: "email" })).ok, false);
    assert.equal((await qa.submitQuotationForReviewAction({ quotationId: quoteId })).ok, false);
    const conv = await convert.convertQuotationAction({ quotationId: quoteId });
    assert.equal(conv.ok, false);
    assert.match((conv as { error: string }).error, /not found/i);
  });

  it("sales staff cannot review/approve quotations or change attribution/assignment", async () => {
    as("salesA");
    assert.equal((await qa.reviewQuotationAction({ quotationId: quoteId, decision: "APPROVE" })).ok, false);
    assert.equal((await leadActions.assignLeadAction({ leadId: "x", assigneeId: u.salesB.id })).ok, false);
    assert.equal((await leadActions.setLeadAttributionAction({ leadId: "x", source: "Referral", reason: "r" })).ok, false);
    assert.equal((await mkt.createCampaignAction({ name: "x", type: "t", channel: "Event" })).ok, false);
    assert.equal((await settingsActions.saveSalesConfigAction({ leadSources: "", campaignChannels: "", lostReasons: "", staleLeadDays: "", maxDiscountPercent: "5" })).ok, false);
  });

  it("an individual explicitly granted quotation.convert can convert their own quotation (and only that)", async () => {
    as("salesA", ["quotation.convert"]);
    const r = await convert.convertQuotationAction({ quotationId: quoteId });
    assert.equal(r.ok, true, JSON.stringify(r));
    const inv = await prisma.invoice.findFirstOrThrow({ where: { quotationId: quoteId } });
    assert.equal(inv.createdById, u.salesA.id);
    assert.equal((await prisma.quotation.findUniqueOrThrow({ where: { id: quoteId } })).convertedById, u.salesA.id);
    // Payments need their own permission even during conversion.
    const q2 = await sales.createQuotation({ firmId, branchId: ids.branch, customerId: ids.customer, taxMode: "NON_GST", userId: u.salesA.id, lines: [line()] });
    as("salesA", ["quotation.convert"], ["payments.create"]);
    const pay = await convert.convertQuotationAction({ quotationId: q2.id, paymentAmount: 50, paymentMethod: "CASH" });
    assert.equal(pay.ok, false);
    assert.match((pay as { error: string }).error, /permission/i);
  });

  it("manager converts a team quotation; the second attempt is refused", async () => {
    const q = await sales.createQuotation({ firmId, branchId: ids.branch, customerId: ids.customer, taxMode: "NON_GST", userId: u.salesB.id, lines: [line()] });
    as("manager");
    const ok = await convert.convertQuotationAction({ quotationId: q.id, paymentAmount: 100, paymentMethod: "UPI" });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const again = await convert.convertQuotationAction({ quotationId: q.id });
    assert.equal(again.ok, false);
    assert.match((again as { error: string }).error, /already/i);
    assert.equal(await prisma.invoice.count({ where: { quotationId: q.id } }), 1);
  });

  it("read-only roles and marketing cannot create leads/quotations; marketing manages campaigns", async () => {
    as("viewer");
    assert.equal((await qa.createQuotationAction({ customerId: ids.customer, taxMode: "NON_GST", lines: [line()] })).ok, false);
    assert.equal((await leadActions.createLeadAction({ name: "A", phone: "9000012345", source: "Referral" })).ok, false);
    as("marketing");
    assert.equal((await convert.convertQuotationAction({ quotationId: quoteId })).ok, false);
    assert.equal((await qa.createQuotationAction({ customerId: ids.customer, taxMode: "NON_GST", lines: [line()] })).ok, false);
    const c = await mkt.createCampaignAction({ name: `Camp ${run}`, type: "Digital", channel: "Instagram", budget: 1000 });
    assert.equal(c.ok, true, JSON.stringify(c));
    const bad = await mkt.createCampaignAction({ name: "", type: "", channel: "Instagram" });
    assert.equal(bad.ok, false);
    const badDates = await mkt.createCampaignAction({ name: `D ${run}`, type: "t", channel: "Event", startDate: "2026-05-02", endDate: "2026-05-01" });
    assert.equal(badDates.ok, false);
    // Leads: marketing may create (campaign enquiries) but not edit or change stage.
    const lead = await leadActions.createLeadAction({ name: "Walk", phone: "9000054321", source: "Instagram" });
    assert.equal(lead.ok, true, JSON.stringify(lead));
    const leadId = (lead as { data: { id: string } }).data.id;
    assert.equal((await leadActions.changeLeadStageAction({ leadId, stage: "CONTACTED" })).ok, false);
    assert.equal((await leadActions.logActivityAction({ leadId, type: "CALL", notes: "x" })).ok, false);
  });

  it("lead actions: validation errors surface as field errors, duplicates are blocked until acknowledged", async () => {
    as("salesA");
    const bad = await leadActions.createLeadAction({ name: "", phone: "", source: "Referral" });
    assert.equal(bad.ok, false);
    assert.ok((bad as { fieldErrors?: Record<string, string[]> }).fieldErrors?.name);
    const first = await leadActions.createLeadAction({ name: "Dup One", phone: "9000099999", source: "Referral" });
    assert.equal(first.ok, true);
    const dup = await leadActions.createLeadAction({ name: "Dup Two", phone: "90000 99999", source: "Referral" });
    assert.equal(dup.ok, false);
    assert.match((dup as { error: string }).error, /already exists/);
    const allowed = await leadActions.createLeadAction({ name: "Dup Two", phone: "9000099999", source: "Referral", allowDuplicate: true });
    assert.equal(allowed.ok, true);
    const check = await leadActions.checkLeadDuplicatesAction({ phone: "9000099999" });
    assert.equal(check.ok && check.data.leads.length, 2);
    // salesB sees the warning (ownership) without being able to open the lead.
    as("salesB");
    const warn = await leadActions.checkLeadDuplicatesAction({ phone: "9000099999" });
    assert.ok(warn.ok && warn.data.leads.every((l) => l.canOpen === false));
    void leadsSvc;
  });

  it("settings: only settings.manage may change the discount limit, and values are validated", async () => {
    as("admin");
    assert.equal((await settingsActions.saveSalesConfigAction({ leadSources: "Walk-in\nReferral", campaignChannels: "Event", lostReasons: "Price", staleLeadDays: "0", maxDiscountPercent: "" })).ok, false);
    assert.equal((await settingsActions.saveSalesConfigAction({ leadSources: "Walk-in", campaignChannels: "Event", lostReasons: "Price", staleLeadDays: "5", maxDiscountPercent: "150" })).ok, false);
    const ok = await settingsActions.saveSalesConfigAction({ leadSources: "Walk-in\nReferral", campaignChannels: "Event", lostReasons: "Price", staleLeadDays: "5", maxDiscountPercent: "12.5" });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const cfg = await (await import("../../src/lib/services/sales-config")).getSalesConfig(firmId);
    assert.equal(cfg.maxStaffDiscountPercent, 12.5);
    assert.deepEqual(cfg.leadSources, ["Walk-in", "Referral"]);
    assert.equal(cfg.staleLeadDays, 5);
  });
});
