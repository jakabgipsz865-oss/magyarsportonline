CREATE TYPE "public"."source_category" AS ENUM('official', 'league', 'club', 'trusted_media', 'tabloid', 'social', 'data_api');--> statement-breakpoint
CREATE TYPE "public"."source_content_mode" AS ENUM('full_text', 'fact_only', 'discovery_only');--> statement-breakpoint
ALTER TYPE "public"."source_type" ADD VALUE 'html';--> statement-breakpoint
ALTER TYPE "public"."source_type" ADD VALUE 'social_embed';--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "league_tags" jsonb;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "category" "source_category";--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "content_mode" "source_content_mode";--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "trust_baseline" integer;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "robots_status" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "terms_status" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "attribution_rule" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "image_policy" jsonb;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "polling_frequency_minutes" integer;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "extractor_name" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_success_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_error_at" timestamp with time zone;