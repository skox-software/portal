ALTER TABLE "clients" ADD COLUMN "next_step_on" date;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "next_step" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "next_step_owner" text;--> statement-breakpoint
CREATE INDEX "clients_next_step_idx" ON "clients" USING btree ("workspace_id","next_step_on");