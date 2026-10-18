-- Tile ERP: new enum values. Kept in their own migration because PostgreSQL
-- cannot use a freshly added enum value in the transaction that adds it
-- (the follow-up migration seeds MARKETING role grants).
-- Idempotent: the local PGlite setup re-applies every migration on start-up.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MARKETING';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LEAD_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LEAD_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LEAD_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LEAD_STAGE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LEAD_ATTRIBUTION_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CAMPAIGN_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CAMPAIGN_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'QUOTATION_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'QUOTATION_REVIEWED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'QUOTATION_SHARED';
