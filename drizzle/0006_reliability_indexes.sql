CREATE INDEX "invoices_document_idx" ON "invoices" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "invoices_workspace_idx" ON "invoices" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "memberships_client_idx" ON "memberships" USING btree ("client_id");