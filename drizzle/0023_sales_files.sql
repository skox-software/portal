-- Sales files: the team's own sales material (demo videos, one-pagers), staff only. Adds one table; changes nothing else.
-- Reversible: drizzle/down/0023_sales_files.sql drops it (stored files stay in Blob until removed from the page).
CREATE TABLE "sales_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" integer,
	"content_type" text,
	"uploaded_by" text NOT NULL,
	"uploaded_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_files" ADD CONSTRAINT "sales_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_files_workspace_idx" ON "sales_files" USING btree ("workspace_id","created_at");