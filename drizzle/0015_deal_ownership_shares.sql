ALTER TABLE "commission_entries" DROP CONSTRAINT "commission_entries_refund_id_unique";--> statement-breakpoint
DROP INDEX "commission_entries_earned_payment_key";--> statement-breakpoint
ALTER TABLE "commission_entries" ADD COLUMN "reversal_of" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_entries_earned_payment_key" ON "commission_entries" USING btree ("invoice_id","earned_at","rep_membership_id") WHERE kind = 'earned';--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_reversal_of_unique" UNIQUE("reversal_of");--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_refund_rep_key" UNIQUE("refund_id","rep_membership_id");