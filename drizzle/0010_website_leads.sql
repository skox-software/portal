ALTER TABLE "deals" ADD COLUMN "gclid" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "attribution" jsonb;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "won_at" timestamp with time zone;