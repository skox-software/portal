CREATE TABLE "withdrawal_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawal_expenses_workspace_reference" UNIQUE("workspace_id","reference")
);
--> statement-breakpoint
ALTER TABLE "withdrawal_expenses" ADD CONSTRAINT "withdrawal_expenses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_expenses" ADD CONSTRAINT "withdrawal_expenses_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;