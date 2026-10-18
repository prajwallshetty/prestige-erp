-- Additive, non-destructive: a nullable "Sub Name" (model / variant line) on
-- products. No existing rows are touched.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "subName" TEXT;
