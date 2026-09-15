ALTER TABLE "llm_usage" ADD COLUMN "role" text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD COLUMN "status" text DEFAULT 'success' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD COLUMN "raw_article_id" uuid;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD COLUMN "story_id" uuid;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD COLUMN "job_id" uuid;