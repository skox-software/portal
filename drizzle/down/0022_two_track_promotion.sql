-- Reverses drizzle/0022_two_track_promotion.sql. Not run by drizzle-kit; apply by hand with psql if needed:
--   psql "$DATABASE_URL" -f drizzle/down/0022_two_track_promotion.sql
-- then delete the 0022 row from drizzle.__drizzle_migrations and deploy the code from before PR "two-track".
-- Deals that were Emailed get that stage back from deal_stage_backup_0022; the new columns are dropped.
BEGIN;
CREATE TYPE "public"."deal_stage_v1" AS ENUM('outreach_1', 'outreach_2', 'outreach_3', 'outreach_4', 'outreach_closed', 'emailed', 'replied', 'meeting', 'proposal_sent', 'won', 'lost');
ALTER TABLE "deals" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "deals" ALTER COLUMN "stage" SET DATA TYPE "public"."deal_stage_v1" USING "stage"::text::"public"."deal_stage_v1";
UPDATE "deals" d SET "stage" = b."stage"::"public"."deal_stage_v1" FROM "deal_stage_backup_0022" b WHERE b."deal_id" = d."id";
DROP TYPE "public"."deal_stage";
ALTER TYPE "public"."deal_stage_v1" RENAME TO "deal_stage";
ALTER TABLE "deals" ALTER COLUMN "stage" SET DEFAULT 'outreach_1';
DROP INDEX IF EXISTS "deals_preview_idx";
ALTER TABLE "deals" DROP COLUMN "promoted_at", DROP COLUMN "promoted_signal", DROP COLUMN "close_reason", DROP COLUMN "close_detail",
  DROP COLUMN "preview_status", DROP COLUMN "preview_requested_at", DROP COLUMN "preview_url", DROP COLUMN "preview_sent_at",
  DROP COLUMN "preview_first_open_at", DROP COLUMN "preview_brief", DROP COLUMN "preview_decision";
DROP TYPE "public"."lead_preview_status";
DROP TABLE "deal_stage_backup_0022";
COMMIT;
