CREATE TYPE "public"."task_trigger" AS ENUM('file_upload');--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completes_on" "task_trigger";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;