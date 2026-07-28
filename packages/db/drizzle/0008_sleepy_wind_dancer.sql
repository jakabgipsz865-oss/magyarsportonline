CREATE TYPE "public"."editorial_correction_category" AS ENUM('slang', 'terminology', 'literal_translation', 'style', 'grammar', 'fact');--> statement-breakpoint
CREATE TABLE "editorial_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"category" "editorial_correction_category" NOT NULL,
	"term_en" text,
	"original_sentence_en" text NOT NULL,
	"current_sentence_hu" text NOT NULL,
	"corrected_sentence_hu" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editorial_corrections" ADD CONSTRAINT "editorial_corrections_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;