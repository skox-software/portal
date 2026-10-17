ALTER TABLE "deals" ADD COLUMN "brief" jsonb;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "bad_number" boolean DEFAULT false NOT NULL;