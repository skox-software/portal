ALTER TABLE "deals" ADD COLUMN "next_step" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "next_step_on" date;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "last_contacted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "deals_next_step_idx" ON "deals" USING btree ("workspace_id","next_step_on");