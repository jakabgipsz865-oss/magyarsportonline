ALTER TABLE "social_posts" ADD COLUMN "canonical_url" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "enqueued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_story_id_platform_unique" UNIQUE("story_id","platform");