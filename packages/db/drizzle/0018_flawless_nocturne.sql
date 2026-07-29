CREATE TYPE "public"."missed_merge_candidate_type" AS ENUM('exact', 'adjacent');--> statement-breakpoint
CREATE TYPE "public"."missed_merge_review_decision" AS ENUM('merge', 'keep_separate', 'uncertain');--> statement-breakpoint
CREATE TABLE "missed_merge_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_a_id" uuid NOT NULL,
	"story_b_id" uuid NOT NULL,
	"candidate_type" "missed_merge_candidate_type" NOT NULL,
	"match_score" integer NOT NULL,
	"matched_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"differing_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision_reason_hu" text NOT NULL,
	"decision" "missed_merge_review_decision",
	"decided_at" timestamp with time zone,
	"decision_note_hu" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "missed_merge_reviews" ADD CONSTRAINT "missed_merge_reviews_story_a_id_stories_id_fk" FOREIGN KEY ("story_a_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missed_merge_reviews" ADD CONSTRAINT "missed_merge_reviews_story_b_id_stories_id_fk" FOREIGN KEY ("story_b_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "missed_merge_reviews_pair_idx" ON "missed_merge_reviews" USING btree ("story_a_id","story_b_id");