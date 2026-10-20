-- Tile ERP: leads, campaigns, quotation revisions/review and attribution.
--
-- Purely additive and idempotent (the local PGlite setup re-applies every
-- migration on start-up). Nothing here drops or rewrites existing business
-- data. The pre-existing quotation/invoice/payment tables only gain nullable
-- or defaulted columns.

-- Enums ----------------------------------------------------------------------
DO $$ BEGIN CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'QUOTATION_SENT', 'NEGOTIATION', 'WON', 'LOST'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "LeadActivityType" AS ENUM ('CREATED', 'CALL', 'MEETING', 'VISIT', 'WHATSAPP', 'EMAIL', 'NOTE', 'STAGE_CHANGE', 'ASSIGNMENT', 'QUOTATION', 'ATTRIBUTION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PromotionDiscountType" AS ENUM ('PERCENT', 'FLAT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "QuotationReviewStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Schema drift already present in schema.prisma but missing from earlier
-- migrations (created on databases bootstrapped with `db push`).
DO $$ BEGIN CREATE TYPE "AccessView" AS ENUM ('COMBINED', 'GST_ONLY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accessView" "AccessView" NOT NULL DEFAULT 'COMBINED';
ALTER TABLE "quotation_lines" ADD COLUMN IF NOT EXISTS "serialNumbers" TEXT[];

-- Quotation extensions --------------------------------------------------------
ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "assignedToId" TEXT,
  ADD COLUMN IF NOT EXISTS "convertedById" TEXT,
  ADD COLUMN IF NOT EXISTS "discountPercentEffective" DECIMAL(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "leadId" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewStatus" "QuotationReviewStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewedById" TEXT,
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "sharedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sharedVia" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "leads" (
    "firmId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "leadNumber" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "email" TEXT,
    "location" TEXT,
    "requirements" TEXT,
    "productInterests" TEXT[],
    "estimatedBudget" DECIMAL(12,2),
    "remarks" TEXT,
    "source" TEXT NOT NULL,
    "sourceDetail" TEXT,
    "campaignId" TEXT,
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "lostReason" TEXT,
    "lostAt" TIMESTAMP(3),
    "wonAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "createdById" TEXT,
    "customerId" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_activities" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "LeadActivityType" NOT NULL,
    "notes" TEXT,
    "outcome" TEXT,
    "fromStage" "LeadStage",
    "toStage" "LeadStage",
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_follow_ups" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "quotationId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "assignedToId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "completionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "campaigns" (
    "firmId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "targetAudience" TEXT,
    "targetLocation" TEXT,
    "budget" DECIMAL(12,2),
    "actualSpend" DECIMAL(12,2),
    "notes" TEXT,
    "isPromotion" BOOLEAN NOT NULL DEFAULT false,
    "offerValidFrom" TIMESTAMP(3),
    "offerValidTo" TIMESTAMP(3),
    "discountType" "PromotionDiscountType",
    "discountValue" DECIMAL(12,2),
    "minOrderValue" DECIMAL(12,2),
    "promoCode" TEXT,
    "ownerId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "quotation_revisions" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "changeNote" TEXT,
    "snapshot" JSONB NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_firmId_stage_idx" ON "leads"("firmId", "stage");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_firmId_assignedToId_idx" ON "leads"("firmId", "assignedToId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_firmId_phoneKey_idx" ON "leads"("firmId", "phoneKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_campaignId_idx" ON "leads"("campaignId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_firmId_createdAt_idx" ON "leads"("firmId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_firmId_nextFollowUpAt_idx" ON "leads"("firmId", "nextFollowUpAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "leads_firmId_leadNumber_key" ON "leads"("firmId", "leadNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_activities_leadId_occurredAt_idx" ON "lead_activities"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_activities_firmId_type_idx" ON "lead_activities"("firmId", "type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_follow_ups_leadId_idx" ON "lead_follow_ups"("leadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_follow_ups_firmId_completedAt_dueAt_idx" ON "lead_follow_ups"("firmId", "completedAt", "dueAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_follow_ups_assignedToId_completedAt_idx" ON "lead_follow_ups"("assignedToId", "completedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "campaigns_firmId_status_idx" ON "campaigns"("firmId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "campaigns_firmId_channel_idx" ON "campaigns"("firmId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_firmId_name_key" ON "campaigns"("firmId", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "quotation_revisions_quotationId_revision_key" ON "quotation_revisions"("quotationId", "revision");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "quotations_leadId_idx" ON "quotations"("leadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "quotations_assignedToId_idx" ON "quotations"("assignedToId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "quotations_firmId_reviewStatus_idx" ON "quotations"("firmId", "reviewStatus");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "quotations" ADD CONSTRAINT "quotations_convertedById_fkey" FOREIGN KEY ("convertedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "quotations" ADD CONSTRAINT "quotations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "quotations" ADD CONSTRAINT "quotations_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "quotations" ADD CONSTRAINT "quotations_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;



-- Backfill ---------------------------------------------------------------------
-- Existing quotations belong to whoever created them.
UPDATE "quotations" SET "assignedToId" = "createdById" WHERE "assignedToId" IS NULL AND "createdById" IS NOT NULL;

-- Baseline revision 1 for every pre-existing quotation so history is complete.
INSERT INTO "quotation_revisions" ("id", "quotationId", "revision", "changeNote", "snapshot", "totalAmount", "createdAt")
SELECT gen_random_uuid()::text, q."id", q."revision", 'Baseline (existing quotation)',
       to_jsonb(q) || jsonb_build_object('lines', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM "quotation_lines" l WHERE l."quotationId" = q."id"), '[]'::jsonb)),
       q."totalAmount", q."createdAt"
FROM "quotations" q
WHERE NOT EXISTS (SELECT 1 FROM "quotation_revisions" r WHERE r."quotationId" = q."id");

-- One live invoice per quotation (DB-level backstop for the application's
-- atomic conversion claim). Created only when existing data has no violations,
-- so the migration can never fail on historical duplicates. Partial indexes are
-- not expressible in schema.prisma; `prisma migrate dev` may offer to drop it —
-- do not accept that.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "invoices" WHERE "quotationId" IS NOT NULL AND "status" <> 'CANCELLED'
    GROUP BY "quotationId" HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "invoices_quotationId_live_key" ON "invoices" ("quotationId")
      WHERE "quotationId" IS NOT NULL AND "status" <> 'CANCELLED';
  END IF;
END $$;

-- Permissions ---------------------------------------------------------------------
INSERT INTO "permissions" ("id", "code", "module", "description", "createdAt")
SELECT gen_random_uuid()::text, v.code, split_part(v.code, '.', 1), v.descr, now()
FROM (VALUES
  ('leads.view',                'View leads assigned to or created by you'),
  ('leads.create',              'Create leads'),
  ('leads.edit',                'Edit leads, log interactions and follow-ups'),
  ('leads.view_all',            'View and manage every lead in scope, not just your own'),
  ('leads.assign',              'Assign and reassign leads to sales staff'),
  ('marketing.view',            'View the marketing dashboard and campaign performance'),
  ('marketing.manage',          'Create and manage campaigns, lead sources and promotions'),
  ('quotation.view_all',        'View quotations created by other sales staff'),
  ('quotation.review',          'Review quotations submitted by sales staff'),
  ('quotation.approve_discount','Approve quotations whose discount exceeds the configured limit')
) AS v(code, descr)
ON CONFLICT ("code") DO NOTHING;

-- Role grants. Only applied when role permissions have been seeded in this
-- database; otherwise the static matrix in src/lib/rbac.ts is the source.
INSERT INTO "role_permissions" ("id", "role", "permissionId", "createdAt")
SELECT gen_random_uuid()::text, g.role::"UserRole", p."id", now()
FROM (VALUES
  ('PLATFORM_ADMIN','leads.view'),('PLATFORM_ADMIN','leads.create'),('PLATFORM_ADMIN','leads.edit'),('PLATFORM_ADMIN','leads.view_all'),('PLATFORM_ADMIN','leads.assign'),
  ('PLATFORM_ADMIN','marketing.view'),('PLATFORM_ADMIN','marketing.manage'),('PLATFORM_ADMIN','quotation.view_all'),('PLATFORM_ADMIN','quotation.review'),('PLATFORM_ADMIN','quotation.approve_discount'),
  ('ADMIN','leads.view'),('ADMIN','leads.create'),('ADMIN','leads.edit'),('ADMIN','leads.view_all'),('ADMIN','leads.assign'),
  ('ADMIN','marketing.view'),('ADMIN','marketing.manage'),('ADMIN','quotation.view_all'),('ADMIN','quotation.review'),('ADMIN','quotation.approve_discount'),
  ('MANAGER','leads.view'),('MANAGER','leads.create'),('MANAGER','leads.edit'),('MANAGER','leads.view_all'),('MANAGER','leads.assign'),
  ('MANAGER','marketing.view'),('MANAGER','quotation.view_all'),('MANAGER','quotation.review'),('MANAGER','quotation.approve_discount'),
  ('SALES_STAFF','leads.view'),('SALES_STAFF','leads.create'),('SALES_STAFF','leads.edit'),
  ('MARKETING','dashboard.view'),('MARKETING','dashboard.view_all_branches'),('MARKETING','marketing.view'),('MARKETING','marketing.manage'),
  ('MARKETING','leads.view'),('MARKETING','leads.create'),('MARKETING','leads.view_all'),
  ('MARKETING','products.view')
) AS g(role, code)
JOIN "permissions" p ON p."code" = g.code
WHERE EXISTS (SELECT 1 FROM "role_permissions")
ON CONFLICT ("role", "permissionId") DO NOTHING;

-- Business rule: sales staff may not convert quotations to invoices by default.
-- Per-user grants (user_permissions) are untouched, so explicit authorisation survives.
DELETE FROM "role_permissions"
WHERE "role" = 'SALES_STAFF'
  AND "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" = 'quotation.convert');
