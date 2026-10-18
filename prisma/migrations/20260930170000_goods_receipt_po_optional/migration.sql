-- Goods receipts must work without a purchase order (over-the-counter buys).
-- The baseline migration incorrectly created goods_receipts.poId as NOT NULL
-- while the Prisma schema declares it optional.
ALTER TABLE "goods_receipts" ALTER COLUMN "poId" DROP NOT NULL;
