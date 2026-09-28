ALTER TABLE "pipeline_jobs" ADD COLUMN "claim_owner" text;--> statement-breakpoint
ALTER TABLE "pipeline_jobs" ADD COLUMN "claim_version" integer DEFAULT 0 NOT NULL;