-- Catalogue OCR import staging tables. Idempotent: the local PGlite setup
-- re-applies every migration on start-up.

DO $$ BEGIN
  CREATE TYPE "CatalogueImportStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'REVIEW_REQUIRED', 'APPROVED', 'IMPORTED', 'PARTIALLY_IMPORTED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CatalogueItemStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'EXCLUDED', 'IMPORTED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DuplicateStatus" AS ENUM ('NEW_PRODUCT', 'EXACT_MATCH', 'POSSIBLE_DUPLICATE', 'CHANGED_DETAILS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CATALOGUE_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CATALOGUE_PROCESSED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CATALOGUE_REVIEWED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CATALOGUE_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CATALOGUE_IMPORTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CATALOGUE_RETRY';

CREATE TABLE IF NOT EXISTS "catalogue_import_jobs" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "pageCount" INTEGER,
    "status" "CatalogueImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "processedPages" INTEGER NOT NULL DEFAULT 0,
    "totalProducts" INTEGER NOT NULL DEFAULT 0,
    "approvedProducts" INTEGER NOT NULL DEFAULT 0,
    "importedProducts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "metadata" JSONB,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "catalogue_import_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalogue_import_jobs_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "catalogue_import_files" (
    "jobId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "catalogue_import_files_pkey" PRIMARY KEY ("jobId"),
    CONSTRAINT "catalogue_import_files_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "catalogue_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "catalogue_import_items" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "sourcePage" INTEGER NOT NULL,
    "status" "CatalogueItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "duplicateStatus" "DuplicateStatus" NOT NULL DEFAULT 'NEW_PRODUCT',
    "duplicateProductId" TEXT,
    "duplicateReason" TEXT,
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 1.0,
    "reviewWarnings" JSONB,

    "brandName" TEXT,
    "brandId" TEXT,
    "productName" TEXT NOT NULL,
    "productCode" TEXT,
    "categoryName" TEXT,
    "categoryId" TEXT,
    "subcategory" TEXT,
    "size" TEXT,
    "surface" TEXT,
    "color" TEXT,
    "material" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'box',
    "piecesPerBox" INTEGER,
    "coveragePerBox" DECIMAL(8,2),
    "mrp" DECIMAL(12,2),
    "purchasePrice" DECIMAL(12,2),
    "sellingPrice" DECIMAL(12,2),
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "hsnCode" TEXT DEFAULT '6907',
    "description" TEXT,
    "attributes" JSONB,
    "rawText" TEXT,

    "primaryImageUrl" TEXT,
    "images" JSONB,

    "importedProductId" TEXT,
    "importedAt" TIMESTAMP(3),
    "modifiedFields" JSONB,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalogue_import_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalogue_import_items_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "catalogue_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "catalogue_import_jobs_firmId_createdAt_idx" ON "catalogue_import_jobs"("firmId", "createdAt");
CREATE INDEX IF NOT EXISTS "catalogue_import_jobs_firmId_status_idx" ON "catalogue_import_jobs"("firmId", "status");
CREATE INDEX IF NOT EXISTS "catalogue_import_items_jobId_sourcePage_idx" ON "catalogue_import_items"("jobId", "sourcePage");
CREATE INDEX IF NOT EXISTS "catalogue_import_items_firmId_productCode_idx" ON "catalogue_import_items"("firmId", "productCode");
