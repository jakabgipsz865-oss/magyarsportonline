CREATE TYPE "public"."story_match_decision" AS ENUM('auto_merge', 'needs_review', 'auto_new_story');--> statement-breakpoint
CREATE TYPE "public"."story_match_review_status" AS ENUM('pending', 'approved_merge', 'approved_new_story');--> statement-breakpoint
CREATE TABLE "story_match_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_article_id" uuid NOT NULL,
	"candidate_story_id" uuid,
	"resulting_story_id" uuid,
	"match_score" integer NOT NULL,
	"has_specific_shared_entity" boolean NOT NULL,
	"matched_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"differing_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sport_mismatch" boolean DEFAULT false NOT NULL,
	"decision" "story_match_decision" NOT NULL,
	"decision_reason_hu" text NOT NULL,
	"review_status" "story_match_review_status",
	"reviewed_by" uuid,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "story_match_decisions" ADD CONSTRAINT "story_match_decisions_raw_article_id_raw_articles_id_fk" FOREIGN KEY ("raw_article_id") REFERENCES "public"."raw_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_match_decisions" ADD CONSTRAINT "story_match_decisions_candidate_story_id_stories_id_fk" FOREIGN KEY ("candidate_story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_match_decisions" ADD CONSTRAINT "story_match_decisions_resulting_story_id_stories_id_fk" FOREIGN KEY ("resulting_story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_match_decisions_decision_review_status_idx" ON "story_match_decisions" USING btree ("decision","review_status");--> statement-breakpoint
CREATE INDEX "story_match_decisions_raw_article_id_idx" ON "story_match_decisions" USING btree ("raw_article_id");