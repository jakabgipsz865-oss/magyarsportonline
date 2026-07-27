ALTER TYPE "public"."review_queue_reason" ADD VALUE 'content_quality_failed';--> statement-breakpoint
ALTER TYPE "public"."review_queue_reason" ADD VALUE 'force_review_mode';--> statement-breakpoint
ALTER TABLE "story_versions" ADD COLUMN "quality_issues" jsonb;