CREATE TABLE "floor_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app" text NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"ok" boolean NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"seconds" integer,
	"user" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "floor_events_app_external_idx" ON "floor_events" USING btree ("app","external_id");--> statement-breakpoint
CREATE INDEX "floor_events_app_at_idx" ON "floor_events" USING btree ("app","at");