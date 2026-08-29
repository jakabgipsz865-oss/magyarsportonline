CREATE TYPE "public"."editorial_knowledge_import_status" AS ENUM('applied', 'blocked', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."editorial_knowledge_status" AS ENUM('draft', 'active', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."editorial_knowledge_type" AS ENUM('terminology', 'multi_word_expression', 'idiom', 'sports_journalism_phrase', 'forbidden_literal_translation', 'preferred_wording', 'headline_rule', 'grammar_style_rule', 'entity_naming', 'competition_naming', 'learned_failure_pattern');--> statement-breakpoint
CREATE TABLE "editorial_knowledge_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stable_key" text NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" text NOT NULL,
	"knowledge_type" "editorial_knowledge_type" NOT NULL,
	"source_language" text NOT NULL,
	"target_language" text NOT NULL,
	"sport" text NOT NULL,
	"contexts" text[] NOT NULL,
	"source_phrase" text,
	"canonical_hu" text,
	"alternative_hu" text[] NOT NULL,
	"avoid_hu" text[] NOT NULL,
	"instruction_hu" text,
	"match_terms" text[] NOT NULL,
	"confidence" real NOT NULL,
	"status" "editorial_knowledge_status" NOT NULL,
	"provenance" jsonb NOT NULL,
	"editorial_note" text,
	"positive_examples" jsonb NOT NULL,
	"negative_examples" jsonb NOT NULL,
	"replaced_by" text,
	"content_hash" text NOT NULL,
	"package_id" text NOT NULL,
	"package_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_knowledge_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" text NOT NULL,
	"package_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"package_digest" text NOT NULL,
	"status" "editorial_knowledge_import_status" NOT NULL,
	"counts" jsonb NOT NULL,
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_knowledge_entries_stable_key_idx" ON "editorial_knowledge_entries" USING btree ("stable_key");--> statement-breakpoint
CREATE INDEX "editorial_knowledge_entries_retrieval_idx" ON "editorial_knowledge_entries" USING btree ("status","sport","source_language","target_language","knowledge_type");--> statement-breakpoint
CREATE INDEX "editorial_knowledge_entries_contexts_gin_idx" ON "editorial_knowledge_entries" USING gin ("contexts");--> statement-breakpoint
CREATE INDEX "editorial_knowledge_entries_match_terms_gin_idx" ON "editorial_knowledge_entries" USING gin ("match_terms");--> statement-breakpoint
CREATE INDEX "editorial_knowledge_import_runs_package_idx" ON "editorial_knowledge_import_runs" USING btree ("package_id","package_version");--> statement-breakpoint
CREATE INDEX "editorial_knowledge_import_runs_digest_idx" ON "editorial_knowledge_import_runs" USING btree ("package_digest");