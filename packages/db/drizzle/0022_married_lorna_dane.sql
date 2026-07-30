CREATE TABLE "knowledge_review_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern_key" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"learned_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editorial_corrections" ALTER COLUMN "story_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "editorial_corrections" ADD COLUMN "portable_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_review_patterns_key_idx" ON "knowledge_review_patterns" USING btree ("pattern_key");--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_corrections_portable_key_idx" ON "editorial_corrections" USING btree ("portable_key");