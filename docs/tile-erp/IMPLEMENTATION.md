# Technic → Tile ERP: audit, changes and implementation report

This extends the existing Technic ERP (Next.js 16 · Prisma 7 · PostgreSQL · NextAuth) with lead
management, manager-controlled invoicing and marketing attribution. Nothing was rebuilt: customers,
products, quotations, invoices, payments, stock, audit and the permission system are the existing ones.

## 1. Module inventory (audit result)

| Module | State before | What was done |
|---|---|---|
| Customers (`customers`, rollups for billed/outstanding) | Working | Reused as the only customer master. Leads link to it (`Lead.customerId`); new customer/lead links on customer page. |
| Products / variants / attributes / categories / brands / stock ledger | Working; picker returned only the first 100 products and had no variant support in quotations | **Enhanced** `/api/products`: multi-term search (name, SKU, brand, category, size/finish attributes, variants), variants, unit, per-branch stock. No second product master. |
| Quotations | Working, but: any user saw every quotation; no owner, revisions, review or discount control; **edit dialog silently dropped a line's variant on save**; conversion check was not atomic (race → duplicate invoices, burned invoice numbers) | **Enhanced in place** (same tables/screens): see §3. |
| Invoices / payments / customer rollups / accounting rules | Working | Reused unchanged; conversion goes through the existing `createInvoice` (stock, serials, credit limit, tax, payment, rollups). |
| Roles & permissions | DB-resolved permission matrix + per-user overrides; Sales Staff had `quotation.convert` | Extended (§4). |
| Audit log | Working | New actions added; every new workflow writes to it. |
| Settings (`settings` key/value) | Working | Reused for configurable lead sources, channels, lost reasons, stale-lead days, **discount limit**. |
| Marketing / leads / campaigns | **Missing** | Built (§2). |
| Reports | Financial reports only | Marketing/sales attribution dashboard added; existing reports untouched. |

Other existing modules (POS, purchases, GRN, returns, invoice import, warranty, serials, ledgers,
expenses, firms/branches, trash) were not modified; a browser crawl of every route as manager, sales
and marketing users shows no errors and correct redirects.

## 2. What was added

**Schema (additive only — see `prisma/migrations/20261020100000_*` and `…100100_*`)**
`Lead`, `LeadActivity` (timeline + stage-change events used for funnel reporting), `LeadFollowUp`,
`Campaign` (budget/spend are **nullable** = "not recorded"; optional promotion/offer fields),
`QuotationRevision`; new `Quotation` columns (`leadId`, `assignedToId`, `revision`, review fields,
`discountPercentEffective`, `convertedById`, share stamps); enums; `UserRole.MARKETING`; audit actions.
Existing rows are untouched; every quotation gets a baseline revision 1 and `assignedToId = createdById`.

**Leads** (`/leads`, `/leads/[id]`): capture from any source, owner, location, requirements, interests,
budget; duplicate warning by phone (blocks until acknowledged; links an existing customer); calls /
meetings / visits / WhatsApp / notes; follow-ups with overdue / today / upcoming / stale views and a
dashboard panel; stages New → Contacted → Qualified → Quotation sent → Negotiation → Won / Lost (lost
needs a reason); assignment; search, filters, sorting, pagination; staff see only their leads.
Original source/campaign are immutable except through an audited, reason-required correction.

**Quotations**: created for a lead (customer created/linked once from the lead), variants/sizes, multiple
lines, ownership + creator + dates, **revision snapshots** on every save, share tracking (WhatsApp /
email / mark-sent → status `Sent`, lead → `Quotation sent`), PDF shows salesperson/revision, salesperson
"submit for review", manager **approve / send back with notes**, configurable discount limit.

**Manager-controlled conversion**: `quotation.convert` is no longer in the default Sales Staff role (it can
be granted to an individual). Conversion runs in **one transaction** that claims the quotation with a
conditional `UPDATE` (concurrent requests serialise; losers roll back *without consuming an invoice
number*), builds the invoice from the quotation's lines (variants, rates, discounts, GST, terms, wording),
verifies the invoice total equals the quoted total, marks the lead Won and writes `QUOTATION_CONVERTED`.
A partial unique index (`invoices(quotationId) WHERE status <> 'CANCELLED'`) is a DB-level backstop.
The original quotation and its revisions are never deleted or overwritten. Deleting a converted invoice
(existing behaviour) re-opens the quotation and the lead.

**Marketing** (`/marketing`, `/marketing/campaigns[/id]`, `/marketing/segments`): campaign CRUD with
budget/spend/owner/audience/promotion rules; dashboard with date, campaign, channel, salesperson and
location filters: leads/quotations/won/lost/win rate, funnel conversion, revenue, collected/outstanding,
spend, cost per lead, ROI, lost reasons, breakdowns by source / channel / location / salesperson,
overdue follow-ups, stale leads. Definitions are rendered on the page. Segments filter the existing
customer base by city, type, purchase recency, lifetime billing, category bought, lead interest.

**Reporting rules**: revenue is read from *invoices* (distinct, non-cancelled, via quotation → lead), never
by joining lead × quotation × invoice, so multiple quotations/invoices per lead cannot double count.
Unknown spend is `—`, never 0; CPL/ROI and blended totals only use campaigns that have spend, and the
page says "x of y campaigns".

## 3. Business rules and where they are enforced (server-side)

* `convertQuotationAction` → `authorize("quotation.convert")`, record scope, `payments.create` for advance.
* All quotation actions re-resolve the record through `quotationScopeWhere(user)`; the PDF route too.
* Leads: every read/write goes through `leadScopeWhere(user)`; assignment needs `leads.assign`.
* Discount limit (`settings.quotation_max_discount_percent`, blank = no limit): over-limit quotations go to
  review and cannot be sent/converted until approved by someone with `quotation.approve_discount`.
* Editing an approved quotation re-opens review; sales staff can delete only their own drafts.

## 4. Roles

| Role | Leads | Quotations | Convert | Marketing |
|---|---|---|---|---|
| Sales Staff | own: create/edit/follow-up | own: create/edit/submit/share | **No** (per-user grant possible) | – |
| Manager | team: all + assign | team: view, review, approve discount, create | Yes | view dashboard |
| Marketing (new) | create, view all | – | – | manage campaigns, dashboard, segments (totals) |
| Admin / Super Admin | all | all | Yes | all |

Viewer/Accountant keep their previous firm-wide read access to quotations.
Existing databases: the migration grants the new permissions/roles **only if role permissions were already
seeded** and revokes `quotation.convert` from Sales Staff; per-user overrides are preserved. Run
`npm run db:sync-permissions` to align a database from the static matrix (note: that script rebuilds
`role_permission` from `rbac.ts`).

## 5. Database impact and rollout

1. `npx prisma migrate deploy` (two idempotent migrations; the first only adds enum values and must
   commit before the second). 2. Optionally `npm run db:sync-permissions`.
   3. Configure *Settings → Sales & marketing* (sources, channels, discount limit).
The migrations also add `users.accessView` and `quotation_lines.serialNumbers` with `IF NOT EXISTS`: they
were already in `schema.prisma` but missing from earlier migrations (a database built purely from
`migrate deploy` could not run the app). `prisma/full_schema.sql` was not regenerated (the PGlite dev
database replays migrations after it). Local dev without `DATABASE_URL` uses PGlite and works.

## 6. Tests

`npm run test:tile-erp` (28 tests). With `TEST_DATABASE_URL=postgresql://…/<name containing "test">`
it runs on real PostgreSQL including concurrency; without it, on PGlite (3 tests skipped). Covers:
lead → follow-up → quotation → review → manager conversion → invoice → payment/outstanding, attribution
and marketing report numbers, duplicate and concurrent conversion (6 parallel → 1 invoice), DB backstop,
migration on a pre-seeded database, and real server actions as sales staff / granted individual / manager /
marketing / viewer / admin (unauthorised conversion, foreign-record access, validation). Also verified:
`tsc --noEmit`, `next build`, existing `test:numbering` and invoice-import unit tests, and a Chromium run
through the UI as sales, manager and marketing users.

## 7. Known limitations / decisions for the owner

* **Direct invoicing by Sales Staff is unchanged** (`invoice.create/edit/delete` remain in their role for
  the existing POS/walk-in flow). Only *quotation conversion* is manager-controlled, as specified. If all
  invoicing should be manager-only, remove those permissions from the role.
* Managers hold `settings.manage` (existing), so they can change the discount limit; restrict if undesired.
* Quantities are whole numbers (existing `Int` column): tile unit conversion (box ↔ sq.ft ↔ pcs) is not
  modelled. Variants are used for sizes/finishes; stock shown is the existing ledger balance.
* Cancelling an invoice (as opposed to deleting it) leaves its quotation `Converted`; revenue excludes
  cancelled invoices. Revenue is gross of sales returns.
* Promotion fields are informational + reporting; offers are not auto-applied to quotations.
* No advertising-platform integration exists or is claimed; spend is entered manually.
* Reminders are in-app (dashboard, lead list, overdue highlighting); no email/SMS/push scheduler.
* Duplicate-lead detection is application-level (no DB unique constraint), so two simultaneous creates can race.
* Email sharing uses a `mailto:` link (no SMTP integration); WhatsApp uses the existing share flow.
* Lead-created customers store the lead's location in `addressLine`, not `city`, because the existing
  tax engine treats a missing state + city as the place of supply (would wrongly yield IGST).
* Pre-existing: `quotationNumber`/`invoiceNumber` are globally unique but every firm defaults to the same prefixes (`QT`, `INV`), so firms created with defaults share one number space and can briefly race. Give each firm its own prefix (Firms → edit). The tests do this.
* `prisma format` re-aligned `schema.prisma`, so its diff is larger than the functional change.
