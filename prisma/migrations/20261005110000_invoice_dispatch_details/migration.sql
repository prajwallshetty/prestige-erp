-- Additive, non-destructive: optional dispatch / e-way fields printed on the invoice PDF.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "dispatchThrough" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "vehicleNumber" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "ewayBillNumber" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "buyerOrderNo" TEXT;
