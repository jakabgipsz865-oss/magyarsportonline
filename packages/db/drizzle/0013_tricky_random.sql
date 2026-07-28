CREATE TABLE "story_credibility_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"band" text NOT NULL,
	"label_hu" text NOT NULL,
	"justification_hu" text NOT NULL,
	"official_confirmed" boolean NOT NULL,
	"corroborating_source_count" integer NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "credibility_score" integer;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "credibility_band" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "credibility_label_hu" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "credibility_justification_hu" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "credibility_official_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "credibility_corroborating_count" integer;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "credibility_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "story_sources" ADD COLUMN "excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "story_sources" ADD COLUMN "excluded_reason" text;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "excluded_reason" text;--> statement-breakpoint
ALTER TABLE "story_read_model" ADD COLUMN "credibility_summary" jsonb;--> statement-breakpoint
ALTER TABLE "story_credibility_history" ADD CONSTRAINT "story_credibility_history_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;