-- Two tracks over one record: Pre-qualified (Outreach 1-4, Close Outreach)
-- and Potential Deals (Emailed, Replied, Meeting, Proposal, Won, Lost).
-- Rebuilds the enum so old values can be mapped and dropped.
-- The CASE must match migratedStage() in lib/pipeline.ts.
CREATE TYPE "public"."deal_stage_v2" AS ENUM('outreach_1', 'outreach_2', 'outreach_3', 'outreach_4', 'outreach_closed', 'emailed', 'replied', 'meeting', 'proposal_sent', 'won', 'lost');--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "stage_next" text;--> statement-breakpoint
UPDATE "deals" d SET "stage_next" = CASE
  WHEN d."stage"::text IN ('won', 'lost', 'proposal_sent') THEN d."stage"::text
  WHEN d."stage"::text = 'negotiation' THEN 'proposal_sent'
  WHEN d."meeting_at" IS NOT NULL THEN 'meeting'
  WHEN EXISTS (SELECT 1 FROM "events" e WHERE e."subject_type" = 'deal' AND e."subject_id" = d."id"::text AND e."verb" IN ('deal.email_sent', 'deal.email_scheduled')) THEN 'emailed'
  WHEN (SELECT e."payload"->>'outcome' FROM "events" e WHERE e."subject_type" = 'deal' AND e."subject_id" = d."id"::text AND e."verb" = 'deal.call_logged' ORDER BY e."created_at" DESC LIMIT 1) = 'not_interested' THEN 'outreach_closed'
  ELSE 'outreach_' || least((SELECT count(*) FROM "events" e WHERE e."subject_type" = 'deal' AND e."subject_id" = d."id"::text AND e."verb" = 'deal.call_logged') + 1, 4)::text
END;--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "stage" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "stage" SET DATA TYPE "public"."deal_stage_v2" USING "stage_next"::"public"."deal_stage_v2";--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "stage_next";--> statement-breakpoint
DROP TYPE "public"."deal_stage";--> statement-breakpoint
ALTER TYPE "public"."deal_stage_v2" RENAME TO "deal_stage";--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "stage" SET DEFAULT 'outreach_1';
