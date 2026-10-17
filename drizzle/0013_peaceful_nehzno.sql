ALTER TYPE "public"."deal_stage" ADD VALUE 'follow_up_2' BEFORE 'proposal_sent';--> statement-breakpoint
ALTER TYPE "public"."deal_stage" ADD VALUE 'follow_up_3' BEFORE 'proposal_sent';--> statement-breakpoint
ALTER TYPE "public"."deal_stage" ADD VALUE 'persistent_follow_up' BEFORE 'proposal_sent';--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "revoked_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "memberships" SET "role" = 'staff_owner' WHERE "client_id" IS NULL AND "role" = 'staff' AND lower("email") IN ('reiss@skoxsoftware.com', 'founders@skoxsoftware.com');
