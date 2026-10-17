CREATE TYPE "public"."commission_kind" AS ENUM('earned', 'clawback', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('pending', 'approved', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."statement_status" AS ENUM('draft', 'approved', 'paid', 'void');--> statement-breakpoint
ALTER TYPE "public"."portal_role" ADD VALUE 'rep';--> statement-breakpoint
CREATE TABLE "commission_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rep_membership_id" uuid NOT NULL,
	"project_id" uuid,
	"invoice_id" uuid,
	"refund_id" uuid,
	"kind" "commission_kind" NOT NULL,
	"base_cents" integer NOT NULL,
	"rate_bps" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "commission_status" DEFAULT 'pending' NOT NULL,
	"earned_at" timestamp with time zone NOT NULL,
	"statement_id" uuid,
	"client_name" text,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_entries_refund_id_unique" UNIQUE("refund_id")
);
--> statement-breakpoint
CREATE TABLE "commission_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rep_membership_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"total_cents" integer NOT NULL,
	"status" "statement_status" DEFAULT 'draft' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"paid_by" text,
	"paid_at" timestamp with time zone,
	"payment_reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_statements_rep_period_key" UNIQUE("rep_membership_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "invoice_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text,
	"stripe_refund_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_refunds_stripe_refund_id_unique" UNIQUE("stripe_refund_id")
);
--> statement-breakpoint
CREATE TABLE "rep_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"phone" text,
	"payout_notes" text,
	"w9_received_at" timestamp with time zone,
	"agreement_signed_at" timestamp with time zone,
	"started_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rep_profiles_membership_id_unique" UNIQUE("membership_id")
);
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "rep_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "rep_source" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "rep_notes" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "meeting_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stripe_session_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "rep_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_rep_membership_id_memberships_id_fk" FOREIGN KEY ("rep_membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_refund_id_invoice_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."invoice_refunds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_statement_id_commission_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."commission_statements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_rep_membership_id_memberships_id_fk" FOREIGN KEY ("rep_membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_refunds" ADD CONSTRAINT "invoice_refunds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_refunds" ADD CONSTRAINT "invoice_refunds_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_profiles" ADD CONSTRAINT "rep_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_profiles" ADD CONSTRAINT "rep_profiles_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_entries_earned_payment_key" ON "commission_entries" USING btree ("invoice_id","earned_at") WHERE kind = 'earned';--> statement-breakpoint
CREATE INDEX "commission_entries_rep_idx" ON "commission_entries" USING btree ("rep_membership_id","earned_at");--> statement-breakpoint
CREATE INDEX "commission_entries_statement_idx" ON "commission_entries" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "commission_statements_workspace_idx" ON "commission_statements" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "invoice_refunds_invoice_idx" ON "invoice_refunds" USING btree ("invoice_id");--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_rep_membership_id_memberships_id_fk" FOREIGN KEY ("rep_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_rep_membership_id_memberships_id_fk" FOREIGN KEY ("rep_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deals_rep_idx" ON "deals" USING btree ("rep_membership_id");--> statement-breakpoint
CREATE INDEX "invoices_payment_intent_idx" ON "invoices" USING btree ("stripe_payment_intent_id");