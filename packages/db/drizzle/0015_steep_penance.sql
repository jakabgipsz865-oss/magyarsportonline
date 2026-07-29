CREATE TYPE "public"."pipeline_job_status" AS ENUM('pending', 'in_progress', 'completed', 'dead_letter');--> statement-breakpoint
CREATE TABLE "pipeline_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" jsonb NOT NULL,
	"status" "pipeline_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pipeline_jobs_status_available_at_idx" ON "pipeline_jobs" USING btree ("status","available_at");