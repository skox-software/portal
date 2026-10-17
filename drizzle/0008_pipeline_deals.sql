CREATE TYPE "public"."deal_stage" AS ENUM('lead', 'proposal_sent', 'negotiation', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"phone" text,
	"website" text,
	"kind" text DEFAULT 'web-app' NOT NULL,
	"value_cents" integer,
	"stage" "deal_stage" DEFAULT 'lead' NOT NULL,
	"owner_email" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"referral_id" uuid,
	"client_id" uuid,
	"project_id" uuid,
	"notes" text,
	"lost_reason" text,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_referral_id_unique" UNIQUE("referral_id"),
	CONSTRAINT "deals_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deals_workspace_idx" ON "deals" USING btree ("workspace_id","stage");