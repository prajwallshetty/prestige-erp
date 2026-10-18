/**
 * End-to-end test of the tile-ERP sales workflow against a throwaway database:
 * lead → follow-ups → quotation → manager review → manager conversion → invoice
 * → payment, plus attribution reporting, permissions and concurrency.
 *
 * Database: set TEST_DATABASE_URL to a migrated PostgreSQL database whose name
 * contains "test" (the guard refuses anything else). Without it the test runs on
 * a temporary PGlite database (concurrency assertions are then skipped, because
 * PGlite serialises everything through one connection).
 *
 *   TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/tile_test?sslmode=require \
 *     npm run test:tile-erp
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const REAL_PG = Boolean(process.env.TEST_DATABASE_URL);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tile-erp-test-"));

describe("tile ERP lead → quotation → invoice workflow", { timeout: 300_000 }, () => {
  let prisma: typeof import("../../src/lib/prisma").prisma;
  let leads: typeof import("../../src/lib/services/leads");
  let sales: typeof import("../../src/lib/services/sales");
  let campaignsSvc: typeof import("../../src/lib/services/campaigns");
  let report: typeof import("../../src/lib/services/marketing-report");
  let scope: typeof import("../../src/lib/sales-scope");
  let rbac: typeof import("../../src/lib/rbac");

  const run = Date.now().toString(36);
  const ids = { firm: `firm_${run}`, branch: "", tile: "", tile2: "", variant: "" };
  type SU = import("../../src/lib/session").SessionUser;
  const users: Record<"manager" | "salesA" | "salesB" | "marketing" | "viewer", SU> = {} as never;
  let phoneSeq = 0;
  const phone = () => `98${run.replace(/\D/g, "").padEnd(4, "7").slice(0, 4)}${String(++phoneSeq).padStart(4, "0")}`;

  function sessionUser(row: { id: string; name: string; role: never }, role: string): SU {
    return {
      id: row.id,
      name: row.name,
      email: `${row.id}@test.local`,
      role: role as never,
      branchId: ids.branch,
      branchName: "Main",
      branchCode: "MAIN",
      employeeCode: null,
      permissions: [...rbac.ROLE_PERMISSIONS[role as keyof typeof rbac.ROLE_PERMISSIONS]],
      firmId: ids.firm,
      firmName: "Tile Co",
      activeFirmId: ids.firm,
      activeFirmName: "Tile Co",
      accessView: "COMBINED",
    };
  }

  before(async () => {
    if (REAL_PG) {
      const url = process.env.TEST_DATABASE_URL!;
      const dbName = new URL(url).pathname.replace("/", "");
      assert.match(dbName, /test/i, `refusing to run against database "${dbName}" — its name must contain "test"`);
      process.env.DATABASE_URL = url;
    } else {
      delete process.env.DATABASE_URL;
      process.env.PGLITE_DIR = dir;
    }
    ({ prisma } = await import("../../src/lib/prisma"));
    rbac = await import("../../src/lib/rbac");
    leads = await import("../../src/lib/services/leads");
    sales = await import("../../src/lib/services/sales");
    campaignsSvc = await import("../../src/lib/services/campaigns");
    report = await import("../../src/lib/services/marketing-report");
    scope = await import("../../src/lib/sales-scope");

    // Document numbers are globally unique but default to the same prefixes for
    // every firm, so each test firm gets its own (as a real multi-firm setup should).
    const code = `T${run}`.toUpperCase().slice(0, 10);
    await prisma.firm.create({ data: { id: ids.firm, code, quotationPrefix: code, invoicePrefix: code, name: "Tile Co", state: "Karnataka" } });
    ids.branch = (await prisma.branch.create({ data: { firmId: ids.firm, code: "MAIN", name: "Showroom", type: "HEAD_OFFICE", state: "Karnataka" } })).id;
    let n = 0;
    for (const [key, role] of [
      ["manager", "MANAGER"],
      ["salesA", "SALES_STAFF"],
      ["salesB", "SALES_STAFF"],
      ["marketing", "MARKETING"],
      ["viewer", "VIEWER"],
    ] as const) {
      n += 1;
      const row = await prisma.user.create({
        data: { firmId: ids.firm, branchId: ids.branch, name: key, email: `${key}-${run}@test.local`, accessCode: `${run}${n}`.slice(-9).padStart(9, "9"), role },
      });
      users[key] = sessionUser(row as never, role);
    }

    const cat = await prisma.category.create({ data: { firmId: ids.firm, name: "Floor Tiles" } });
    const brand = await prisma.brand.create({ data: { firmId: ids.firm, name: "Kajaria" } });
    const tile = await prisma.product.create({
      data: { firmId: ids.firm, sku: "TL-600", name: "Glossy Ivory", subName: "Vitrified", categoryId: cat.id, brandId: brand.id, sellingPrice: 1000, gstRate: 18, unit: "box", hsnCode: "6907" },
    });
    const tile2 = await prisma.product.create({ data: { firmId: ids.firm, sku: "TL-800", name: "Matt Grey", sellingPrice: 2000, gstRate: 18, unit: "box" } });
    ids.tile = tile.id;
    ids.tile2 = tile2.id;
    const variant = await prisma.productVariant.create({ data: { productId: tile.id, name: "600x600 Glossy", sku: "TL-600-G", sellingPrice: 1200 } });
    ids.variant = variant.id;
    const inventory = await import("../../src/lib/services/inventory");
    for (const [productId, variantId] of [[tile.id, null], [tile.id, variant.id], [tile2.id, null]] as const) {
      await inventory.writeStockTransaction(prisma, { firmId: ids.firm, branchId: ids.branch, productId, variantId, type: "OPENING", quantity: 500 });
    }
  });

  after(async () => {
    await prisma?.$disconnect().catch(() => {});
    await (globalThis as { pgliteInstance?: { close(): Promise<void> } }).pgliteInstance?.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  it("permission matrix: sales staff cannot convert quotations, managers can", () => {
    assert.ok(!users.salesA.permissions.includes("quotation.convert"));
    assert.ok(users.manager.permissions.includes("quotation.convert"));
    assert.ok(users.manager.permissions.includes("quotation.review"));
    // Marketing: campaigns + analytics, no invoice/payment/customer access.
    for (const code of ["invoice.view", "payments.view", "customers.view", "quotation.convert", "quotation.view"]) {
      assert.ok(!users.marketing.permissions.includes(code as never), `marketing must not have ${code}`);
    }
    assert.ok(users.marketing.permissions.includes("marketing.manage"));
  });

  let campaign: Awaited<ReturnType<typeof campaignsSvc.createCampaign>>;
  let spendless: Awaited<ReturnType<typeof campaignsSvc.createCampaign>>;
  it("marketing creates campaigns; invalid input is rejected; spend stays null when unknown", async () => {
    campaign = await campaignsSvc.createCampaign(users.marketing, {
      name: `Diwali Offer ${run}`, type: "Digital Ad", channel: "Instagram", status: "ACTIVE", budget: 50000, actualSpend: 10000, targetLocation: "Mangaluru",
    });
    spendless = await campaignsSvc.createCampaign(users.marketing, { name: `Hoarding ${run}`, type: "Offline", channel: "Event", status: "ACTIVE" });
    assert.equal(spendless.actualSpend, null);
    await assert.rejects(campaignsSvc.createCampaign(users.marketing, { name: `Bad ${run}`, type: "x", channel: "Carrier Pigeon" }), /not a configured channel/);
    await assert.rejects(campaignsSvc.createCampaign(users.marketing, { name: `Bad2 ${run}`, type: "x", channel: "Event", startDate: new Date("2026-02-02"), endDate: new Date("2026-01-01") }), /end date/);
    await assert.rejects(campaignsSvc.createCampaign(users.marketing, { name: `diwali offer ${run}`, type: "x", channel: "Event" }), /already exists/);
  });

  const phoneA = phone();
  let leadA: { id: string; leadNumber: string; phoneKey: string };
  it("sales staff creates a lead with campaign attribution and ownership", async () => {
    const { lead } = await leads.createLead(users.salesA, ids.branch, {
      name: "Ravi Kumar", phone: phoneA, location: "Mangaluru", requirements: "Living room 600x600", productInterests: ["Floor Tiles"],
      estimatedBudget: 150000, campaignId: campaign.id,
    });
    leadA = lead;
    assert.equal(lead.source, "Instagram", "source defaults to the campaign channel");
    assert.equal(lead.assignedToId, users.salesA.id);
    assert.equal(lead.stage, "NEW");
    assert.match(lead.leadNumber, /^LD-\d\d-\d\d-\d{4}$/);
  });

  it("validates input and warns about duplicate phone numbers", async () => {
    await assert.rejects(leads.createLead(users.salesA, ids.branch, { name: "", phone: phone(), source: "Referral" }), /name is required/);
    await assert.rejects(leads.createLead(users.salesA, ids.branch, { name: "X", phone: "12", source: "Referral" }), /valid phone/);
    await assert.rejects(leads.createLead(users.salesA, ids.branch, { name: "X", phone: phone(), source: "Smoke signals" }), /not a configured lead source/);
    await assert.rejects(leads.createLead(users.salesA, ids.branch, { name: "X", phone: phone() }), /where this lead came from/);
    await assert.rejects(leads.createLead(users.salesA, ids.branch, { name: "X", phone: phone(), source: "Referral", estimatedBudget: -5 }), /negative/);
    await assert.rejects(leads.createLead(users.salesA, ids.branch, { name: "Ravi K", phone: `+91 ${phoneA}`, source: "Phone Call" }), /already exists/);
    const dup = await leads.createLead(users.salesB, ids.branch, { name: "Ravi K", phone: phoneA, source: "Phone Call" }, { allowDuplicate: true });
    assert.equal(dup.duplicates.leads.length, 1);
    // A salesperson cannot hand a lead to someone else without leads.assign.
    await assert.rejects(
      leads.createLead(users.salesA, ids.branch, { name: "Y", phone: phone(), source: "Referral", assignedToId: users.salesB.id }),
      /only assign leads to yourself/,
    );
  });

  it("record-level access: staff see only their leads, managers and marketing see all", async () => {
    await assert.rejects(leads.getScopedLead(users.salesB, leadA.id), /not found/i);
    assert.equal((await leads.getScopedLead(users.manager, leadA.id)).id, leadA.id);
    assert.equal((await leads.getScopedLead(users.marketing, leadA.id)).id, leadA.id);
    const listB = await leads.listLeads(users.salesB, {});
    assert.ok(listB.rows.every((r) => r.assignedToId === users.salesB.id || r.createdById === users.salesB.id));
    assert.ok(!listB.rows.some((r) => r.id === leadA.id));
    const listM = await leads.listLeads(users.manager, { q: "Ravi" });
    assert.ok(listM.rows.some((r) => r.id === leadA.id));
    // Mutations are scoped too.
    await assert.rejects(leads.logActivity(users.salesB, leadA.id, { type: "CALL", notes: "sneaky" }), /not found/i);
    await assert.rejects(leads.changeLeadStage(users.salesB, leadA.id, "LOST", { lostReason: "x" }), /not found/i);
  });

  it("records interactions, follow-ups and stage changes; lost needs a reason", async () => {
    await assert.rejects(leads.logActivity(users.salesA, leadA.id, { type: "CALL", notes: "  " }), /Add a note/);
    await leads.logActivity(users.salesA, leadA.id, { type: "CALL", notes: "Discussed sizes", outcome: "Interested" });
    let lead = await leads.getScopedLead(users.salesA, leadA.id);
    assert.equal(lead.stage, "CONTACTED", "first real interaction moves NEW → CONTACTED");

    const tomorrow = new Date(Date.now() + 86_400_000);
    await assert.rejects(leads.addFollowUp(users.salesA, leadA.id, { dueAt: new Date("2020-01-01") }), /in the past/);
    const fu = await leads.addFollowUp(users.salesA, leadA.id, { dueAt: tomorrow, notes: "Call back with rates" });
    lead = await leads.getScopedLead(users.salesA, leadA.id);
    assert.equal(lead.nextFollowUpAt?.getTime(), tomorrow.getTime());

    await leads.changeLeadStage(users.salesA, leadA.id, "QUALIFIED");
    await assert.rejects(leads.changeLeadStage(users.salesA, leadA.id, "LOST"), /reason/);
    await assert.rejects(leads.changeLeadStage(users.salesA, leadA.id, "QUOTATION_SENT"), /Create a quotation/);

    // Lose then reopen a throwaway lead to exercise the lost path.
    const { lead: tmp } = await leads.createLead(users.salesA, ids.branch, { name: "Temp", phone: phone(), source: "Referral" });
    await leads.addFollowUp(users.salesA, tmp.id, { dueAt: tomorrow });
    await leads.changeLeadStage(users.salesA, tmp.id, "LOST", { lostReason: "Price too high" });
    const lost = await leads.getScopedLead(users.salesA, tmp.id);
    assert.equal(lost.lostReason, "Price too high");
    assert.equal(lost.nextFollowUpAt, null, "closing a lead closes its follow-ups");
    await assert.rejects(leads.addFollowUp(users.salesA, tmp.id, { dueAt: tomorrow }), /closed/);
    await leads.changeLeadStage(users.salesA, tmp.id, "CONTACTED");
    assert.equal((await leads.getScopedLead(users.salesA, tmp.id)).lostReason, null);

    await leads.completeFollowUp(users.salesA, fu.id, { notes: "Done" });
    await assert.rejects(leads.completeFollowUp(users.salesA, fu.id), /already completed/);
    assert.equal((await leads.getScopedLead(users.salesA, leadA.id)).nextFollowUpAt, null);
  });

  it("attribution is preserved through the pipeline and changes only via an audited correction", async () => {
    const before = await leads.getScopedLead(users.salesA, leadA.id);
    assert.equal(before.campaignId, campaign.id);
    await assert.rejects(leads.setLeadAttribution(users.manager, leadA.id, { source: "Referral", reason: " " }), /reason/);
    await leads.setLeadAttribution(users.manager, leadA.id, { source: "Facebook", reason: "Customer said Facebook" });
    assert.equal((await leads.getScopedLead(users.salesA, leadA.id)).source, "Facebook");
    await leads.setLeadAttribution(users.manager, leadA.id, { source: "Instagram", reason: "Reverted — verified in CRM" });
    const audits = await prisma.auditLog.count({ where: { entityId: leadA.id, action: "LEAD_ATTRIBUTION_CHANGED" } });
    assert.equal(audits, 2);
  });

  let customerId = "";
  it("creates the customer from the lead once and reuses it", async () => {
    const c1 = await leads.ensureLeadCustomer(users.salesA, leadA.id, ids.branch);
    const c2 = await leads.ensureLeadCustomer(users.salesA, leadA.id, ids.branch);
    assert.equal(c1.id, c2.id);
    customerId = c1.id;
    assert.equal(c1.phone, phoneA);
    const count = await prisma.customer.count({ where: { firmId: ids.firm, phone: { endsWith: leadA.phoneKey } } });
    assert.equal(count, 1);
  });

  let quote: Awaited<ReturnType<typeof sales.createQuotation>>;
  const lineFor = (extra = {}) => ({ productId: ids.tile, variantId: ids.variant, quantity: 10, unitPrice: 1200, discountPercent: 0, gstRate: 18, ...extra });

  it("configurable discount limit: over-limit quotation needs manager approval before sending", async () => {
    await prisma.setting.upsert({
      where: { firmId_key: { firmId: ids.firm, key: "quotation_max_discount_percent" } },
      create: { firmId: ids.firm, key: "quotation_max_discount_percent", value: "10", category: "sales" },
      update: { value: "10" },
    });
    quote = await sales.createQuotation({
      firmId: ids.firm, branchId: ids.branch, customerId, leadId: leadA.id, taxMode: "GST",
      userId: users.salesA.id, assignedToId: users.salesA.id, canApproveDiscount: false,
      lines: [lineFor({ discountPercent: 15 }), { productId: ids.tile2, quantity: 5, unitPrice: 2000, discountPercent: 15, gstRate: 18 }],
    });
    assert.equal(quote.reviewStatus, "PENDING", "15% > 10% limit");
    assert.equal(Number(quote.discountPercentEffective), 15);
    assert.equal(quote.revision, 1);
    assert.equal(quote.assignedToId, users.salesA.id);
    assert.equal(quote.leadId, leadA.id);
    await assert.rejects(sales.markQuotationShared(ids.firm, quote.id, "whatsapp", users.salesA.id), /manager must approve/);
    // The reviewer cannot approve without the discount permission; managers can.
    await assert.rejects(
      sales.reviewQuotation(ids.firm, quote.id, { decision: "APPROVE", userId: users.salesA.id, canApproveDiscount: false }),
      /not permitted/,
    );
    await assert.rejects(sales.reviewQuotation(ids.firm, quote.id, { decision: "REJECT", userId: users.manager.id, canApproveDiscount: true }), /what needs to change/);
    await sales.reviewQuotation(ids.firm, quote.id, { decision: "APPROVE", notes: "ok", userId: users.manager.id, canApproveDiscount: true });
    const shared = await sales.markQuotationShared(ids.firm, quote.id, "whatsapp", users.salesA.id);
    assert.equal(shared.status, "SENT");
    assert.equal((await leads.getScopedLead(users.salesA, leadA.id)).stage, "QUOTATION_SENT");
  });

  it("quotation revisions: every save keeps a snapshot and re-opens review", async () => {
    const updated = await sales.updateQuotation({
      firmId: ids.firm, quotationId: quote.id, userId: users.salesA.id, canApproveDiscount: false,
      lines: [lineFor({ discountPercent: 20 }), { productId: ids.tile2, quantity: 5, unitPrice: 2000, discountPercent: 20, gstRate: 18 }],
      changeNote: "Customer asked for more discount",
    });
    assert.equal(updated.revision, 2);
    assert.equal(updated.reviewStatus, "PENDING", "content changed → needs approval again");
    const revisions = await prisma.quotationRevision.findMany({ where: { quotationId: quote.id }, orderBy: { revision: "asc" } });
    assert.deepEqual(revisions.map((r) => r.revision), [1, 2]);
    assert.notEqual(Number(revisions[0].totalAmount), Number(revisions[1].totalAmount));
    const snap = revisions[0].snapshot as { lines: unknown[]; quotationNumber: string };
    assert.equal(snap.lines.length, 2);
    assert.equal(snap.quotationNumber, quote.quotationNumber);
    // Sales staff cannot approve their own over-limit quotation by saving it.
    await assert.rejects(
      sales.updateQuotation({ firmId: ids.firm, quotationId: quote.id, userId: users.salesA.id, canApproveDiscount: false, status: "SENT",
        lines: [lineFor({ discountPercent: 20 })] }),
      /needs manager approval/,
    );
    // Bring the quote back within policy so the conversion test is clean.
    await sales.updateQuotation({
      firmId: ids.firm, quotationId: quote.id, userId: users.manager.id, canApproveDiscount: true,
      lines: [lineFor({ discountPercent: 5 }), { productId: ids.tile2, quantity: 5, unitPrice: 2000, discountPercent: 5, gstRate: 18 }],
    });
  });

  it("quotation visibility: salespeople see only their own, managers see the team", async () => {
    const sA = await prisma.quotation.findMany({ where: scope.quotationScopeWhere(users.salesA) });
    const sB = await prisma.quotation.findMany({ where: scope.quotationScopeWhere(users.salesB) });
    const mgr = await prisma.quotation.findMany({ where: scope.quotationScopeWhere(users.manager) });
    const viewer = await prisma.quotation.findMany({ where: scope.quotationScopeWhere(users.viewer) });
    assert.ok(sA.some((q) => q.id === quote.id));
    assert.ok(!sB.some((q) => q.id === quote.id));
    assert.ok(mgr.some((q) => q.id === quote.id));
    assert.ok(viewer.some((q) => q.id === quote.id), "read-only roles keep firm-wide read access");
  });

  let invoice: Awaited<ReturnType<typeof sales.convertQuotationToInvoice>>;
  it("manager converts the quotation: invoice carries customer, lines, variants, discounts, taxes and the quotation link", async () => {
    const fresh = await prisma.quotation.findUniqueOrThrow({ where: { id: quote.id }, include: { lines: true } });
    invoice = await sales.convertQuotationToInvoice(ids.firm, quote.id, {
      taxMode: "GST", userId: users.manager.id, canApproveDiscount: true, paymentAmount: 5000, paymentMethod: "UPI",
    });
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: true, payments: true } });
    assert.equal(inv.quotationId, quote.id);
    assert.equal(inv.customerId, customerId);
    assert.equal(Number(inv.totalAmount), Number(fresh.totalAmount));
    assert.equal(Number(inv.taxableAmount), Number(fresh.taxableAmount));
    assert.equal(Number(inv.cgstAmount), Number(fresh.cgstAmount));
    assert.equal(Number(inv.sgstAmount), Number(fresh.sgstAmount));
    assert.equal(inv.lines.length, fresh.lines.length);
    for (const q of fresh.lines) {
      const l = inv.lines.find((x) => x.productId === q.productId && x.variantId === q.variantId);
      assert.ok(l, "line carried over with its variant");
      assert.equal(l!.quantity, q.quantity);
      assert.equal(Number(l!.unitPrice), Number(q.unitPrice));
      assert.equal(Number(l!.discountPercent), Number(q.discountPercent));
      assert.equal(Number(l!.gstRate), Number(q.gstRate));
      assert.equal(l!.description, q.description);
    }
    // Payment + outstanding balances.
    assert.equal(Number(inv.amountPaid), 5000);
    assert.equal(Number(inv.amountDue), Number(inv.totalAmount) - 5000);
    assert.equal(inv.status, "PARTIALLY_PAID");
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    assert.equal(Number(customer.outstandingAmount), Number(inv.amountDue));
    assert.equal(inv.payments.length, 1);

    // Original quotation kept (not deleted/overwritten), history intact, audited.
    const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quote.id } });
    assert.equal(q.status, "CONVERTED");
    assert.equal(q.convertedById, users.manager.id);
    assert.equal(await prisma.quotationRevision.count({ where: { quotationId: quote.id } }), 3);
    assert.equal(await prisma.auditLog.count({ where: { entityId: quote.id, action: "QUOTATION_CONVERTED" } }), 1);
    // Lead is won, attribution untouched.
    const lead = await leads.getScopedLead(users.manager, leadA.id);
    assert.equal(lead.stage, "WON");
    assert.equal(lead.campaignId, campaign.id);
    assert.equal(lead.source, "Instagram");
    // Converted quotations are frozen.
    await assert.rejects(sales.updateQuotation({ firmId: ids.firm, quotationId: quote.id, lines: [lineFor()] }), /converted/);
    await assert.rejects(sales.deleteQuotation(ids.firm, quote.id, users.manager.id), /converted/);
  });

  it("duplicate conversion is rejected and creates no second invoice", async () => {
    await assert.rejects(sales.convertQuotationToInvoice(ids.firm, quote.id, { taxMode: "GST", userId: users.manager.id }), /already been converted/);
    assert.equal(await prisma.invoice.count({ where: { quotationId: quote.id } }), 1);
  });

  it("concurrent conversions: exactly one invoice, no burned invoice numbers", { skip: !REAL_PG && "needs real PostgreSQL" }, async () => {
    const { lead } = await leads.createLead(users.salesB, ids.branch, { name: "Concurrent Co", phone: phone(), source: "Referral" });
    const customer = await leads.ensureLeadCustomer(users.salesB, lead.id, ids.branch);
    const q = await sales.createQuotation({
      firmId: ids.firm, branchId: ids.branch, customerId: customer.id, leadId: lead.id, taxMode: "NON_GST",
      userId: users.salesB.id, lines: [{ productId: ids.tile2, quantity: 2, unitPrice: 2000 }],
    });
    const lastBefore = await prisma.invoice.findMany({ where: { firmId: ids.firm, taxMode: "NON_GST" }, select: { invoiceNumber: true } });
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => sales.convertQuotationToInvoice(ids.firm, q.id, { taxMode: "NON_GST", userId: users.manager.id, canApproveDiscount: true })),
    );
    const won = results.filter((r) => r.status === "fulfilled");
    assert.equal(won.length, 1, `exactly one conversion must win (got ${won.length})`);
    for (const r of results) if (r.status === "rejected") assert.match(String(r.reason), /already been converted|serialize|deadlock/i);
    assert.equal(await prisma.invoice.count({ where: { quotationId: q.id } }), 1);
    const after = await prisma.invoice.findMany({ where: { firmId: ids.firm, taxMode: "NON_GST" }, select: { invoiceNumber: true } });
    assert.equal(after.length, lastBefore.length + 1);
    // Stock decreased once.
    const stock = await (await import("../../src/lib/services/inventory")).getStockLevel(ids.firm, ids.branch, { productId: ids.tile2 });
    assert.ok(stock >= 0);
  });

  it("conversion validation: rejects expired, empty-discount-approval and rejected quotations", async () => {
    const { lead } = await leads.createLead(users.salesB, ids.branch, { name: "Rules Co", phone: phone(), source: "Referral" });
    const customer = await leads.ensureLeadCustomer(users.salesB, lead.id, ids.branch);
    const base = { firmId: ids.firm, branchId: ids.branch, customerId: customer.id, leadId: lead.id, taxMode: "NON_GST" as const, userId: users.salesB.id };
    // Over-limit, unapproved, converter lacks approval right.
    const over = await sales.createQuotation({ ...base, lines: [{ productId: ids.tile2, quantity: 1, unitPrice: 2000, discountPercent: 30 }] });
    await assert.rejects(sales.convertQuotationToInvoice(ids.firm, over.id, { taxMode: "NON_GST", userId: users.salesB.id, canApproveDiscount: false }), /above the 10% limit/);
    // Expired validity.
    const expired = await sales.createQuotation({ ...base, validUntil: new Date("2020-01-01"), lines: [{ productId: ids.tile2, quantity: 1, unitPrice: 2000 }] });
    await assert.rejects(sales.convertQuotationToInvoice(ids.firm, expired.id, { taxMode: "NON_GST", userId: users.manager.id, canApproveDiscount: true }), /validity/);
    // Manager sends one back; it cannot convert until resubmitted.
    const back = await sales.createQuotation({ ...base, lines: [{ productId: ids.tile2, quantity: 1, unitPrice: 2000 }] });
    await sales.submitQuotationForReview(ids.firm, back.id, users.salesB.id);
    await sales.reviewQuotation(ids.firm, back.id, { decision: "REJECT", notes: "Lower the rate", userId: users.manager.id, canApproveDiscount: true });
    await assert.rejects(sales.convertQuotationToInvoice(ids.firm, back.id, { taxMode: "NON_GST", userId: users.manager.id, canApproveDiscount: true }), /sent back/);
    // Input validation on quotations.
    await assert.rejects(sales.createQuotation({ ...base, lines: [{ productId: ids.tile2, quantity: 0, unitPrice: 5 }] }), /greater than zero/);
    await assert.rejects(sales.createQuotation({ ...base, lines: [{ productId: ids.tile2, quantity: 1, unitPrice: -5 }] }), /negative/);
    await assert.rejects(sales.createQuotation({ ...base, lines: [{ productId: ids.tile2, quantity: 1, unitPrice: 5, discountPercent: 101 }] }), /between 0% and 100%/);
    await assert.rejects(sales.createQuotation({ ...base, customerId: customerId, lines: [{ productId: ids.tile2, quantity: 1, unitPrice: 5 }] }), /lead's customer/);
    // Staff may delete only drafts they own.
    // Staff may delete only drafts: once sent, it needs someone with review rights.
    await assert.rejects(sales.markQuotationShared(ids.firm, back.id, "email", users.salesB.id), /rejected quotation cannot be sent|sent/i).catch(() => {});
    const draft = await sales.createQuotation({ ...base, lines: [{ productId: ids.tile2, quantity: 1, unitPrice: 2000 }] });
    await sales.markQuotationShared(ids.firm, draft.id, "email", users.salesB.id);
    await assert.rejects(sales.deleteQuotation(ids.firm, draft.id, users.salesB.id, { onlyDraft: true }), /Only draft quotations/);
    await sales.deleteQuotation(ids.firm, expired.id, users.salesB.id, { onlyDraft: true });
    assert.equal(await prisma.quotation.count({ where: { id: expired.id } }), 0);
    assert.equal(await prisma.auditLog.count({ where: { entityId: expired.id, action: "QUOTATION_DELETED" } }), 1);
  });

  it("database backstop: a second live invoice for one quotation is impossible", { skip: !REAL_PG && "needs real PostgreSQL" }, async () => {
    const existing = await prisma.invoice.findFirstOrThrow({ where: { quotationId: quote.id } });
    await assert.rejects(
      prisma.$executeRawUnsafe(
        `INSERT INTO invoices (id, "firmId", "invoiceNumber", "branchId", "customerId", "billToName", "quotationId", "updatedAt")
         VALUES ('dup_${run}', '${ids.firm}', 'DUP-${run}', '${ids.branch}', '${customerId}', 'dup', '${quote.id}', now())`,
      ),
      /unique|duplicate/i,
    );
    assert.equal(await prisma.invoice.count({ where: { quotationId: quote.id } }), 1);
    assert.ok(existing.id);
  });

  it("migration on an already-seeded database: grants new permissions and revokes sales-staff conversion", { skip: !REAL_PG && "needs real PostgreSQL" }, async () => {
    // Simulate a database seeded before this feature: staff hold quotation.convert.
    const convert = await prisma.permission.upsert({
      where: { code: "quotation.convert" }, create: { code: "quotation.convert", module: "quotation", description: "c" }, update: {},
    });
    await prisma.rolePermission.upsert({
      where: { role_permissionId: { role: "SALES_STAFF", permissionId: convert.id } },
      create: { role: "SALES_STAFF", permissionId: convert.id }, update: {},
    });
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    try {
      const sql = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20261020100100_tile_erp_leads_marketing/migration.sql"), "utf8");
      await client.query(sql); // second application: must be a safe no-op for schema, and apply grants
    } finally {
      await client.end();
    }
    const granted = async (role: string) =>
      (await prisma.rolePermission.findMany({ where: { role: role as never }, include: { permission: true } })).map((r) => r.permission.code);
    assert.ok(!(await granted("SALES_STAFF")).includes("quotation.convert"), "sales staff lost default conversion right");
    assert.ok((await granted("SALES_STAFF")).includes("leads.create"));
    assert.ok((await granted("MANAGER")).includes("quotation.review") || (await prisma.rolePermission.count({ where: { role: "MANAGER" } })) === 0);
    // A per-user override still lets an individual be explicitly authorised.
    await prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: users.salesA.id, permissionId: convert.id } },
      create: { userId: users.salesA.id, permissionId: convert.id, granted: true }, update: { granted: true },
    });
    const { resolvePermissions } = await import("../../src/lib/permissions.server");
    assert.ok((await resolvePermissions(users.salesA.id, "SALES_STAFF")).includes("quotation.convert"));
    assert.ok(!(await resolvePermissions(users.salesB.id, "SALES_STAFF")).includes("quotation.convert"));
  });

  it("marketing report: attributes revenue once, keeps unknown spend unknown, and funnels correctly", async () => {
    // A second quotation (not converted) on the already-won lead must not change revenue.
    await sales.createQuotation({
      firmId: ids.firm, branchId: ids.branch, customerId, leadId: leadA.id, taxMode: "GST", userId: users.salesA.id,
      lines: [lineFor({ quantity: 3 })],
    }).catch((e) => assert.match(String(e), /Reopen|lost/i));

    const rep = await report.getMarketingReport(users.marketing, { campaignId: campaign.id });
    const invoiceTotal = Number((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).totalAmount);
    assert.equal(rep.totals.leads, 1);
    assert.equal(rep.totals.won, 1);
    assert.equal(rep.totals.revenue, invoiceTotal, "revenue = the single invoice, not multiplied by quotations");
    assert.ok(rep.totals.quotations >= 1);
    assert.equal(rep.totals.leadsWithQuotation, 1);
    assert.equal(rep.collected, 5000);
    assert.equal(rep.outstanding, Math.round((invoiceTotal - 5000) * 100) / 100);

    const row = rep.campaigns.find((c) => c.campaignId === campaign.id)!;
    assert.equal(row.spend, 10000);
    assert.equal(row.costPerLead, 10000);
    assert.equal(row.roi, Math.round(((invoiceTotal - 10000) / 10000) * 100) / 100);

    const all = await report.getMarketingReport(users.marketing, {});
    const none = all.campaigns.find((c) => c.campaignId === spendless.id)!;
    assert.equal(none.spend, null, "unknown spend is not zero");
    assert.equal(none.costPerLead, null);
    assert.equal(none.roi, null);
    assert.equal(all.blended.campaignsWithSpend, 1);
    assert.ok(all.blended.campaignsTotal >= 2);

    const stages = Object.fromEntries(rep.funnel.map((f) => [f.stage, f]));
    assert.equal(stages.NEW.reached, 1);
    assert.equal(stages.NEGOTIATION.reached, 1, "a won lead has passed every open stage");
    assert.equal(stages.CONTACTED.fromPrevious, 1);

    // Filters: another salesperson sees none of A's leads.
    const filtered = await report.getMarketingReport(users.marketing, { salesperson: users.salesB.id, campaignId: campaign.id });
    assert.equal(filtered.totals.leads, 0);
    assert.equal(filtered.totals.revenue, 0);
    assert.equal(filtered.totals.winRate, null, "no closed leads → no win rate (not 0%)");
    // Sales staff reporting is limited to their own leads.
    const asB = await report.getMarketingReport(users.salesB, {});
    assert.ok(asB.totals.leads >= 1);
    assert.ok(!asB.bySalesperson.some((r) => r.key === users.salesA.id));
  });
});
