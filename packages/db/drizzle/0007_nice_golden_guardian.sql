CREATE TABLE "editorial_ab_snapshots" (
	"story_id" uuid PRIMARY KEY NOT NULL,
	"title_a" text NOT NULL,
	"lead_a" text NOT NULL,
	"body_a" text NOT NULL,
	"title_b" text NOT NULL,
	"lead_b" text NOT NULL,
	"body_b" text NOT NULL,
	"rewrite_accepted" boolean NOT NULL,
	"rejection_kind" text,
	"rejection_reason" jsonb,
	"quality_a" jsonb NOT NULL,
	"quality_b" jsonb NOT NULL,
	"judge" jsonb,
	"per_call_usage" jsonb NOT NULL,
	"total_usage" jsonb NOT NULL,
	"duration_ms" integer NOT NULL,
	"lexicon_matches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"original_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editorial_ab_snapshots" ADD CONSTRAINT "editorial_ab_snapshots_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;