ALTER TABLE "stories" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "raw_articles" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "story_read_model" ADD COLUMN "image_url" text;