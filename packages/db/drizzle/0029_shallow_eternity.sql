ALTER TABLE "raw_articles" ADD COLUMN "rss_title" text;--> statement-breakpoint
ALTER TABLE "raw_articles" ADD COLUMN "rss_description" text;--> statement-breakpoint
ALTER TABLE "raw_articles" ADD COLUMN "rss_guid" text;--> statement-breakpoint
ALTER TABLE "raw_articles" ADD COLUMN "first_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raw_articles" ADD COLUMN "processing_status" text;--> statement-breakpoint
ALTER TABLE "raw_articles" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "raw_articles" ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_articles" ADD COLUMN "processing_available_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raw_articles" ADD COLUMN "processing_owner" text;--> statement-breakpoint
ALTER TABLE "raw_articles" ADD COLUMN "processing_locked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "raw_articles_processing_due_idx" ON "raw_articles" USING btree ("processing_status","processing_available_at");