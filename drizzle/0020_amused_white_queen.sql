CREATE TABLE "outreach_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_recipients_email_unique" UNIQUE("email")
);

--> statement-breakpoint
INSERT INTO "outreach_recipients" ("email", "suppressed")
SELECT DISTINCT lower(trim("contact_email")), true FROM "deals"
WHERE "do_not_email" = true AND nullif(trim("contact_email"), '') IS NOT NULL
ON CONFLICT ("email") DO UPDATE SET "suppressed" = true;
