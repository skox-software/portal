-- Outreach and the Pipeline, with promotion as the only door between them.
-- 1. New columns: why a deal was promoted, why outreach closed, and the lead's preview website.
-- 2. Retire "Emailed": sending a cold email is outreach, not interest. Each Emailed deal goes back
--    to the outreach attempt its calls and emails reached, unless they replied or booked a meeting.
--    The CASE must match retiredEmailedStage() in lib/pipeline.ts.
-- Reversible: every moved row is copied to deal_stage_backup_0022 first; drizzle/down/0022_two_track_promotion.sql
-- restores it. scripts/two-track-dry-run.mjs prints what this would move without changing anything.
CREATE TYPE "public"."lead_preview_status" AS ENUM('none', 'requested', 'researching', 'awaiting_approval', 'building', 'ready', 'sent', 'opened', 'archived');--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "promoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "promoted_signal" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "close_reason" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "close_detail" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "preview_status" "lead_preview_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "preview_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "preview_url" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "preview_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "preview_first_open_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "preview_brief" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "preview_decision" jsonb;--> statement-breakpoint
CREATE INDEX "deals_preview_idx" ON "deals" USING btree ("preview_status");--> statement-breakpoint
CREATE TABLE "deal_stage_backup_0022" (
  "deal_id" uuid PRIMARY KEY NOT NULL,
  "stage" text NOT NULL,
  "backed_up_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "deal_stage_backup_0022" ("deal_id", "stage") SELECT "id", "stage"::text FROM "deals" WHERE "stage"::text = 'emailed';--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "stage" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "stage" SET DATA TYPE text;--> statement-breakpoint
-- A reply is an inbound email on one of the deal's threads, unless they opted out (a "stop" reply isn't interest).
UPDATE "deals" d SET "stage" = CASE
  WHEN d."meeting_at" IS NOT NULL THEN 'meeting'
  WHEN NOT d."do_not_email" AND EXISTS (SELECT 1 FROM "email_messages" m JOIN "email_threads" t ON t."id" = m."thread_id" WHERE t."deal_id" = d."id" AND m."direction" = 'inbound') THEN 'replied'
  WHEN (SELECT e."payload"->>'outcome' FROM "events" e WHERE e."subject_type" = 'deal' AND e."subject_id" = d."id"::text AND e."verb" = 'deal.call_logged' ORDER BY e."created_at" DESC LIMIT 1) = 'not_interested' THEN 'outreach_closed'
  ELSE 'outreach_' || least(greatest((SELECT count(*) FROM "events" e WHERE e."subject_type" = 'deal' AND e."subject_id" = d."id"::text AND (e."verb" IN ('deal.email_sent', 'deal.email_scheduled') OR (e."verb" = 'deal.call_logged' AND e."payload"->>'outcome' IS NOT NULL))) + 1, 1), 4)::text
END
WHERE d."stage" = 'emailed';--> statement-breakpoint
-- Close reasons we can read from the record: the last call said "Not interested", or the number was flagged.
UPDATE "deals" d SET "close_reason" = CASE
  WHEN (SELECT e."payload"->>'outcome' FROM "events" e WHERE e."subject_type" = 'deal' AND e."subject_id" = d."id"::text AND e."verb" = 'deal.call_logged' ORDER BY e."created_at" DESC LIMIT 1) = 'not_interested' THEN 'not_interested'
  WHEN d."bad_number" THEN 'bad_number'
END
WHERE d."stage" = 'outreach_closed' AND d."close_reason" IS NULL;--> statement-breakpoint
-- The signal behind Pipeline deals, only where the record shows it: a website enquiry, a reply, a booked meeting.
UPDATE "deals" d SET
  "promoted_signal" = CASE
    WHEN d."source" = 'website' THEN 'inbound'
    WHEN NOT d."do_not_email" AND EXISTS (SELECT 1 FROM "email_messages" m JOIN "email_threads" t ON t."id" = m."thread_id" WHERE t."deal_id" = d."id" AND m."direction" = 'inbound') THEN 'replied'
    WHEN d."meeting_at" IS NOT NULL THEN 'meeting'
  END,
  "promoted_at" = CASE
    WHEN d."source" = 'website' THEN d."created_at"
    WHEN NOT d."do_not_email" AND EXISTS (SELECT 1 FROM "email_messages" m JOIN "email_threads" t ON t."id" = m."thread_id" WHERE t."deal_id" = d."id" AND m."direction" = 'inbound')
      THEN (SELECT min(m."sent_at") FROM "email_messages" m JOIN "email_threads" t ON t."id" = m."thread_id" WHERE t."deal_id" = d."id" AND m."direction" = 'inbound')
    WHEN d."meeting_at" IS NOT NULL THEN d."meeting_at"
  END
WHERE d."stage" IN ('replied', 'meeting', 'proposal_sent', 'won');--> statement-breakpoint
DROP TYPE "public"."deal_stage";--> statement-breakpoint
CREATE TYPE "public"."deal_stage" AS ENUM('outreach_1', 'outreach_2', 'outreach_3', 'outreach_4', 'outreach_closed', 'replied', 'meeting', 'proposal_sent', 'won', 'lost');--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "stage" SET DATA TYPE "public"."deal_stage" USING "stage"::"public"."deal_stage";--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "stage" SET DEFAULT 'outreach_1'::"public"."deal_stage";
