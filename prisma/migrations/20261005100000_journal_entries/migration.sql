-- Additive: new journal table + enum for manual adjustments / discounts.
-- No existing table is altered or dropped.
DO $$ BEGIN
  CREATE TYPE "JournalEntryType" AS ENUM ('DEBIT_ADJUSTMENT', 'CREDIT_ADJUSTMENT', 'DISCOUNT_ALLOWED', 'DISCOUNT_RECEIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "journal_entries" (
    "id" TEXT NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "type" "JournalEntryType" NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "narration" TEXT NOT NULL,
    "reference" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_entryNumber_key" ON "journal_entries"("entryNumber");
CREATE INDEX IF NOT EXISTS "journal_entries_firmId_entryDate_idx" ON "journal_entries"("firmId", "entryDate");
CREATE INDEX IF NOT EXISTS "journal_entries_customerId_idx" ON "journal_entries"("customerId");
CREATE INDEX IF NOT EXISTS "journal_entries_supplierId_idx" ON "journal_entries"("supplierId");

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
