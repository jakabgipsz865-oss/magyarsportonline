ALTER TYPE "public"."entity_type" ADD VALUE 'coach' BEFORE 'team';--> statement-breakpoint
ALTER TYPE "public"."story_status" ADD VALUE 'invalid_merge';--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "invalid_merge_reason_hu" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "invalidated_at" timestamp with time zone;