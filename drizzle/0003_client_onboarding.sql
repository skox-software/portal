CREATE TYPE "public"."onboarding_status" AS ENUM('invited', 'in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "onboardings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"invited_email" text NOT NULL,
	"invited_by" text NOT NULL,
	"status" "onboarding_status" DEFAULT 'invited' NOT NULL,
	"call_recap" text,
	"recap_confirmed" boolean,
	"recap_feedback" text,
	"internal_notes" text,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brand" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"access" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"team" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kickoff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"last_reminded_at" timestamp with time zone,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"staff_alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboardings_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "date_tentative" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "scheduling_url" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "welcome_video_url" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "team_intro" text;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboardings_workspace_idx" ON "onboardings" USING btree ("workspace_id","status");