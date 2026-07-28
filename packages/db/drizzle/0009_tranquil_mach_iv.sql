CREATE TYPE "public"."editorial_correction_application_stage" AS ENUM('hungarian_writer', 'editorial_rewrite');--> statement-breakpoint
CREATE TYPE "public"."editorial_correction_application_verdict" AS ENUM('applied', 'partial', 'not_applied');--> statement-breakpoint
CREATE TABLE "editorial_correction_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correction_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"stage" "editorial_correction_application_stage" NOT NULL,
	"verdict" "editorial_correction_application_verdict" NOT NULL,
	"evidence" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editorial_correction_applications" ADD CONSTRAINT "editorial_correction_applications_correction_id_editorial_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "public"."editorial_corrections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_correction_applications" ADD CONSTRAINT "editorial_correction_applications_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;