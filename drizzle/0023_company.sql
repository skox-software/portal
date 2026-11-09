CREATE TYPE "public"."company_proposal_status" AS ENUM('pending', 'approved', 'denied', 'done', 'withdrawn');--> statement-breakpoint
CREATE TABLE "company_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"seat" text NOT NULL,
	"run_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"why" text NOT NULL,
	"body" text,
	"impact" text DEFAULT 'medium' NOT NULL,
	"confidence" integer NOT NULL,
	"wrong_if" text,
	"links" jsonb,
	"status" "company_proposal_status" DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"edited" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"done_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"seat" text NOT NULL,
	"summary" text NOT NULL,
	"outcome" text DEFAULT 'ok' NOT NULL,
	"proposal_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_proposals" ADD CONSTRAINT "company_proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_proposals" ADD CONSTRAINT "company_proposals_run_id_company_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."company_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_runs" ADD CONSTRAINT "company_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_proposals_status_idx" ON "company_proposals" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "company_runs_seat_idx" ON "company_runs" USING btree ("workspace_id","seat","created_at");