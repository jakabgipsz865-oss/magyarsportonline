-- pgvector kiterjesztés a raw_articles.embedding oszlophoz (dedup ANN keresés,
-- docs/architecture/02-agents.md §2.2). drizzle-kit ezt nem generálja
-- automatikusan, kézzel egészítettük ki az első migrációhoz.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('success', 'error', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('player', 'team', 'competition', 'league', 'venue');--> statement-breakpoint
CREATE TYPE "public"."fact_type" AS ENUM('score', 'quote', 'injury_status', 'transfer_status', 'event_time', 'other');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('ingested', 'deduped', 'merged', 'error');--> statement-breakpoint
CREATE TYPE "public"."review_queue_reason" AS ENUM('high_risk', 'contradiction', 'low_confidence', 'manual_flag', 'single_source_sensitive_category', 'prompt_injection_suspected');--> statement-breakpoint
CREATE TYPE "public"."review_queue_status" AS ENUM('pending', 'approved', 'rejected', 'edited');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."social_platform" AS ENUM('facebook', 'threads', 'x');--> statement-breakpoint
CREATE TYPE "public"."social_post_status" AS ENUM('queued', 'posting', 'posted', 'failed', 'retracted');--> statement-breakpoint
CREATE TYPE "public"."source_license_type" AS ENUM('public_rss', 'licensed_api', 'scrape_allowed');--> statement-breakpoint
CREATE TYPE "public"."source_reliability_tier" AS ENUM('A', 'B', 'C');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('rss', 'api', 'scraper');--> statement-breakpoint
CREATE TYPE "public"."story_entity_role" AS ENUM('subject', 'opponent', 'mentioned');--> statement-breakpoint
CREATE TYPE "public"."story_source_contribution_type" AS ENUM('initial', 'corroboration', 'new_info', 'contradiction', 'possible_duplicate');--> statement-breakpoint
CREATE TYPE "public"."story_status" AS ENUM('draft', 'fact_checked', 'written', 'seo_ready', 'pending_review', 'published', 'updated', 'retracted');--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"type" "source_type" NOT NULL,
	"language" text NOT NULL,
	"license_type" "source_license_type" NOT NULL,
	"reliability_tier" "source_reliability_tier" NOT NULL,
	"fetch_config" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"onboarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_fetch_status" text
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_hu" text NOT NULL,
	"parent_id" uuid,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_hu" text NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "entity_type" NOT NULL,
	"name_canonical" text NOT NULL,
	"name_hu" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_ref" text
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text,
	"canonical_title" text NOT NULL,
	"status" "story_status" DEFAULT 'draft' NOT NULL,
	"risk_level" "risk_level",
	"confidence_score" numeric(4, 3),
	"category_id" uuid,
	"current_version_id" uuid,
	"version_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"is_developing" boolean DEFAULT false NOT NULL,
	CONSTRAINT "stories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "story_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"title_hu" text NOT NULL,
	"lead_hu" text NOT NULL,
	"body_hu" text NOT NULL,
	"meta_description" text,
	"seo_tags" jsonb,
	"structured_data" jsonb,
	"change_summary_hu" text,
	"generated_by_model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"fact_consistency_score" numeric(4, 3),
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_versions_story_id_version_number_unique" UNIQUE("story_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "raw_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"title_original" text NOT NULL,
	"body_original" text NOT NULL,
	"language" text NOT NULL,
	"embedding" vector(1536),
	"extracted_entities" jsonb,
	"ingest_status" "ingest_status" DEFAULT 'ingested' NOT NULL,
	"story_id" uuid,
	"published_at_source" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_articles_source_url_unique" UNIQUE("source_url")
);
--> statement-breakpoint
CREATE TABLE "story_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"raw_article_id" uuid NOT NULL,
	"contribution_type" "story_source_contribution_type" NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_sources_story_id_raw_article_id_unique" UNIQUE("story_id","raw_article_id")
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"raw_article_id" uuid NOT NULL,
	"fact_type" "fact_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"corroboration_count" integer DEFAULT 1 NOT NULL,
	"is_contradicted" boolean DEFAULT false NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" "story_entity_role" NOT NULL,
	CONSTRAINT "story_entities_story_id_entity_id_unique" UNIQUE("story_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "story_tags" (
	"story_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "story_tags_story_id_tag_id_pk" PRIMARY KEY("story_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "review_queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"story_version_id" uuid NOT NULL,
	"reason" "review_queue_reason" NOT NULL,
	"status" "review_queue_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"story_version_id" uuid NOT NULL,
	"platform" "social_platform" NOT NULL,
	"external_post_id" text,
	"post_text" text NOT NULL,
	"status" "social_post_status" DEFAULT 'queued' NOT NULL,
	"posted_at" timestamp with time zone,
	CONSTRAINT "social_posts_story_version_id_platform_unique" UNIQUE("story_version_id","platform")
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_name" text NOT NULL,
	"story_id" uuid,
	"correlation_id" uuid NOT NULL,
	"trigger_event" text NOT NULL,
	"status" "agent_run_status" NOT NULL,
	"llm_cost_usd" numeric(10, 6),
	"error_message" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_fingerprints" (
	"fingerprint_hash" text PRIMARY KEY NOT NULL,
	"story_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_read_model" (
	"story_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title_hu" text NOT NULL,
	"lead_hu" text NOT NULL,
	"body_html" text NOT NULL,
	"meta_description" text,
	"structured_data" jsonb,
	"sources_summary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" jsonb,
	"confidence_score" numeric(4, 3),
	"is_developing" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version_history_summary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "story_read_model_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_current_version_id_story_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."story_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_versions" ADD CONSTRAINT "story_versions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_articles" ADD CONSTRAINT "raw_articles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_articles" ADD CONSTRAINT "raw_articles_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_sources" ADD CONSTRAINT "story_sources_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_sources" ADD CONSTRAINT "story_sources_raw_article_id_raw_articles_id_fk" FOREIGN KEY ("raw_article_id") REFERENCES "public"."raw_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_raw_article_id_raw_articles_id_fk" FOREIGN KEY ("raw_article_id") REFERENCES "public"."raw_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_entities" ADD CONSTRAINT "story_entities_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_entities" ADD CONSTRAINT "story_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_tags" ADD CONSTRAINT "story_tags_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_tags" ADD CONSTRAINT "story_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_queue_items" ADD CONSTRAINT "review_queue_items_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_queue_items" ADD CONSTRAINT "review_queue_items_story_version_id_story_versions_id_fk" FOREIGN KEY ("story_version_id") REFERENCES "public"."story_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_story_version_id_story_versions_id_fk" FOREIGN KEY ("story_version_id") REFERENCES "public"."story_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_fingerprints" ADD CONSTRAINT "story_fingerprints_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_read_model" ADD CONSTRAINT "story_read_model_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;