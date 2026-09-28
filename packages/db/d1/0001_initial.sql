-- D1 target schema generated from a reviewed PostgreSQL dump plus remediation migrations.

-- UUIDs are supplied by the application; timestamp and JSON values are normalized at import.

PRAGMA foreign_keys = ON;

CREATE TABLE "__drizzle_migrations" (
  "id" INTEGER NOT NULL,
  "hash" TEXT NOT NULL,
  "created_at" INTEGER,
  PRIMARY KEY ("id")
);

CREATE TABLE "agent_runs" (
  "id" TEXT NOT NULL,
  "agent_name" TEXT NOT NULL,
  "story_id" TEXT,
  "correlation_id" TEXT NOT NULL,
  "trigger_event" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('success', 'error', 'skipped')),
  "llm_cost_usd" TEXT,
  "error_message" TEXT,
  "occurred_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "categories" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name_hu" TEXT NOT NULL,
  "parent_id" TEXT,
  PRIMARY KEY ("id"),
  UNIQUE ("slug"),
  FOREIGN KEY ("parent_id") REFERENCES "categories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "editorial_ab_snapshots" (
  "story_id" TEXT NOT NULL,
  "title_a" TEXT NOT NULL,
  "lead_a" TEXT NOT NULL,
  "body_a" TEXT NOT NULL,
  "title_b" TEXT NOT NULL,
  "lead_b" TEXT NOT NULL,
  "body_b" TEXT NOT NULL,
  "rewrite_accepted" INTEGER NOT NULL,
  "rejection_kind" TEXT,
  "rejection_reason" TEXT CHECK (json_valid("rejection_reason")),
  "quality_a" TEXT NOT NULL CHECK (json_valid("quality_a")),
  "quality_b" TEXT NOT NULL CHECK (json_valid("quality_b")),
  "judge" TEXT CHECK (json_valid("judge")),
  "per_call_usage" TEXT NOT NULL CHECK (json_valid("per_call_usage")),
  "total_usage" TEXT NOT NULL CHECK (json_valid("total_usage")),
  "duration_ms" INTEGER NOT NULL,
  "lexicon_matches" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("lexicon_matches")),
  "original_sources" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("original_sources")),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("story_id"),
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "editorial_correction_applications" (
  "id" TEXT NOT NULL,
  "correction_id" TEXT NOT NULL,
  "story_id" TEXT NOT NULL,
  "stage" TEXT NOT NULL CHECK ("stage" IN ('hungarian_writer', 'editorial_rewrite')),
  "verdict" TEXT NOT NULL CHECK ("verdict" IN ('applied', 'partial', 'not_applied')),
  "evidence" TEXT,
  "detected_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("correction_id") REFERENCES "editorial_corrections" ("id") DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "editorial_corrections" (
  "id" TEXT NOT NULL,
  "story_id" TEXT,
  "category" TEXT NOT NULL CHECK ("category" IN ('slang', 'terminology', 'literal_translation', 'style', 'grammar', 'fact')),
  "term_en" TEXT,
  "original_sentence_en" TEXT NOT NULL,
  "current_sentence_hu" TEXT NOT NULL,
  "corrected_sentence_hu" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "portable_key" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "editorial_knowledge_entries" (
  "id" TEXT NOT NULL,
  "stable_key" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "schema_version" TEXT NOT NULL,
  "knowledge_type" TEXT NOT NULL CHECK ("knowledge_type" IN ('terminology', 'multi_word_expression', 'idiom', 'sports_journalism_phrase', 'forbidden_literal_translation', 'preferred_wording', 'headline_rule', 'grammar_style_rule', 'entity_naming', 'competition_naming', 'learned_failure_pattern')),
  "source_language" TEXT NOT NULL,
  "target_language" TEXT NOT NULL,
  "sport" TEXT NOT NULL,
  "contexts" TEXT NOT NULL CHECK (json_valid("contexts")),
  "source_phrase" TEXT,
  "canonical_hu" TEXT,
  "alternative_hu" TEXT NOT NULL CHECK (json_valid("alternative_hu")),
  "avoid_hu" TEXT NOT NULL CHECK (json_valid("avoid_hu")),
  "instruction_hu" TEXT,
  "match_terms" TEXT NOT NULL CHECK (json_valid("match_terms")),
  "confidence" REAL NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('draft', 'active', 'deprecated')),
  "provenance" TEXT NOT NULL CHECK (json_valid("provenance")),
  "editorial_note" TEXT,
  "positive_examples" TEXT NOT NULL CHECK (json_valid("positive_examples")),
  "negative_examples" TEXT NOT NULL CHECK (json_valid("negative_examples")),
  "replaced_by" TEXT,
  "content_hash" TEXT NOT NULL,
  "package_id" TEXT NOT NULL,
  "package_version" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id")
);

CREATE TABLE "editorial_knowledge_import_runs" (
  "id" TEXT NOT NULL,
  "package_id" TEXT NOT NULL,
  "package_version" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL,
  "package_digest" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('applied', 'blocked', 'duplicate')),
  "counts" TEXT NOT NULL CHECK (json_valid("counts")),
  "error_summary" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id")
);

CREATE TABLE "entities" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('player', 'coach', 'team', 'competition', 'league', 'venue')),
  "name_canonical" TEXT NOT NULL,
  "name_hu" TEXT NOT NULL,
  "aliases" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("aliases")),
  "external_ref" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE "facts" (
  "id" TEXT NOT NULL,
  "story_id" TEXT NOT NULL,
  "raw_article_id" TEXT NOT NULL,
  "fact_type" TEXT NOT NULL CHECK ("fact_type" IN ('score', 'quote', 'injury_status', 'transfer_status', 'event_time', 'other')),
  "payload" TEXT NOT NULL CHECK (json_valid("payload")),
  "corroboration_count" INTEGER NOT NULL DEFAULT 1,
  "is_contradicted" INTEGER NOT NULL DEFAULT 0,
  "extracted_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "excluded" INTEGER NOT NULL DEFAULT 0,
  "excluded_reason" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("raw_article_id") REFERENCES "raw_articles" ("id") DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "knowledge_review_patterns" (
  "id" TEXT NOT NULL,
  "pattern_key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" TEXT NOT NULL CHECK (json_valid("payload")),
  "learned_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id")
);

CREATE TABLE "llm_usage" (
  "id" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "input_tokens" INTEGER NOT NULL,
  "output_tokens" INTEGER NOT NULL,
  "cost_usd" TEXT NOT NULL,
  "occurred_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "provider" TEXT NOT NULL DEFAULT 'anthropic',
  "role" TEXT NOT NULL DEFAULT 'unspecified',
  "status" TEXT NOT NULL DEFAULT 'success',
  "error_code" TEXT,
  "raw_article_id" TEXT,
  "story_id" TEXT,
  "job_id" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE "missed_merge_reviews" (
  "id" TEXT NOT NULL,
  "story_a_id" TEXT NOT NULL,
  "story_b_id" TEXT NOT NULL,
  "candidate_type" TEXT NOT NULL CHECK ("candidate_type" IN ('exact', 'adjacent')),
  "match_score" INTEGER NOT NULL,
  "matched_entities" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("matched_entities")),
  "differing_entities" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("differing_entities")),
  "decision_reason_hu" TEXT NOT NULL,
  "decision" TEXT CHECK ("decision" IN ('merge', 'keep_separate', 'uncertain')),
  "decided_at" TEXT,
  "decision_note_hu" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("story_a_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("story_b_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "pipeline_jobs" (
  "id" TEXT NOT NULL,
  "event" TEXT NOT NULL CHECK (json_valid("event")),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'in_progress', 'completed', 'dead_letter')),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "available_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "locked_at" TEXT,
  "last_error" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "claim_owner" TEXT,
  "claim_version" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);

CREATE TABLE "raw_articles" (
  "id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "title_original" TEXT NOT NULL,
  "body_original" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "embedding" TEXT,
  "extracted_entities" TEXT CHECK (json_valid("extracted_entities")),
  "ingest_status" TEXT NOT NULL DEFAULT 'ingested' CHECK ("ingest_status" IN ('ingested', 'deduped', 'merged', 'error')),
  "story_id" TEXT,
  "published_at_source" TEXT,
  "ingested_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "image_url" TEXT,
  "subtitle_original" TEXT,
  "author_original" TEXT,
  "content_origin" TEXT NOT NULL DEFAULT 'rss_snippet',
  "inline_images" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("inline_images")),
  "rss_title" TEXT,
  "rss_description" TEXT,
  "rss_guid" TEXT,
  "first_seen_at" TEXT,
  "processing_status" TEXT,
  "decision_reason" TEXT,
  "processing_attempts" INTEGER NOT NULL DEFAULT 0,
  "processing_available_at" TEXT,
  "processing_owner" TEXT,
  "processing_locked_at" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("source_id") REFERENCES "sources" ("id") DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "review_queue_items" (
  "id" TEXT NOT NULL,
  "story_id" TEXT NOT NULL,
  "story_version_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL CHECK ("reason" IN ('high_risk', 'contradiction', 'low_confidence', 'manual_flag', 'single_source_sensitive_category', 'prompt_injection_suspected', 'content_quality_failed', 'force_review_mode')),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected', 'edited')),
  "reviewed_by" TEXT,
  "review_note" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "resolved_at" TEXT,
  "snoozed_until" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("story_version_id") REFERENCES "story_versions" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "social_posts" (
  "id" TEXT NOT NULL,
  "story_id" TEXT NOT NULL,
  "story_version_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL CHECK ("platform" IN ('facebook', 'threads', 'x')),
  "external_post_id" TEXT,
  "post_text" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued', 'posting', 'posted', 'failed', 'retracted')),
  "posted_at" TEXT,
  "canonical_url" TEXT,
  "error_code" TEXT,
  "last_error" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "enqueued_at" TEXT,
  "last_attempt_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id"),
  UNIQUE ("story_id", "platform"),
  UNIQUE ("story_version_id", "platform"),
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("story_version_id") REFERENCES "story_versions" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "sources" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "base_url" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('rss', 'api', 'scraper', 'html', 'social_embed')),
  "language" TEXT NOT NULL,
  "license_type" TEXT NOT NULL CHECK ("license_type" IN ('public_rss', 'licensed_api', 'scrape_allowed', 'pending_review')),
  "reliability_tier" TEXT NOT NULL CHECK ("reliability_tier" IN ('A', 'B', 'C')),
  "fetch_config" TEXT NOT NULL CHECK (json_valid("fetch_config")),
  "is_active" INTEGER NOT NULL DEFAULT 0,
  "onboarded_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "last_fetched_at" TEXT,
  "last_fetch_status" TEXT,
  "country" TEXT,
  "league_tags" TEXT CHECK (json_valid("league_tags")),
  "category" TEXT CHECK ("category" IN ('official', 'league', 'club', 'trusted_media', 'tabloid', 'social', 'data_api')),
  "content_mode" TEXT CHECK ("content_mode" IN ('full_text', 'fact_only', 'discovery_only')),
  "trust_baseline" INTEGER,
  "robots_status" TEXT,
  "terms_status" TEXT,
  "attribution_rule" TEXT,
  "image_policy" TEXT CHECK (json_valid("image_policy")),
  "polling_frequency_minutes" INTEGER,
  "extractor_name" TEXT,
  "last_success_at" TEXT,
  "last_error_at" TEXT,
  "ingest_watermark_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE "stories" (
  "id" TEXT NOT NULL,
  "slug" TEXT,
  "canonical_title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'fact_checked', 'written', 'seo_ready', 'pending_review', 'published', 'updated', 'retracted', 'invalid_merge')),
  "risk_level" TEXT CHECK ("risk_level" IN ('low', 'medium', 'high')),
  "confidence_score" TEXT,
  "category_id" TEXT,
  "current_version_id" TEXT,
  "version_count" INTEGER NOT NULL DEFAULT 0,
  "first_seen_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "last_updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "published_at" TEXT,
  "is_developing" INTEGER NOT NULL DEFAULT 0,
  "image_url" TEXT,
  "credibility_score" INTEGER,
  "credibility_band" TEXT,
  "credibility_label_hu" TEXT,
  "credibility_justification_hu" TEXT,
  "credibility_official_confirmed" INTEGER NOT NULL DEFAULT 0,
  "credibility_corroborating_count" INTEGER,
  "credibility_updated_at" TEXT,
  "invalid_merge_reason_hu" TEXT,
  "invalidated_at" TEXT,
  PRIMARY KEY ("id"),
  UNIQUE ("slug"),
  FOREIGN KEY ("category_id") REFERENCES "categories" ("id") DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("current_version_id") REFERENCES "story_versions" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "story_credibility_history" (
  "id" TEXT NOT NULL,
  "story_id" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "band" TEXT NOT NULL,
  "label_hu" TEXT NOT NULL,
  "justification_hu" TEXT NOT NULL,
  "official_confirmed" INTEGER NOT NULL,
  "corroborating_source_count" INTEGER NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'auto',
  "recorded_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "explanation" TEXT CHECK (json_valid("explanation")),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "story_entities" (
  "id" TEXT NOT NULL,
  "story_id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "role" TEXT NOT NULL CHECK ("role" IN ('subject', 'opponent', 'mentioned')),
  PRIMARY KEY ("id"),
  UNIQUE ("story_id", "entity_id"),
  FOREIGN KEY ("entity_id") REFERENCES "entities" ("id") DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "story_fingerprints" (
  "fingerprint_hash" TEXT NOT NULL,
  "story_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("fingerprint_hash"),
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "story_match_decisions" (
  "id" TEXT NOT NULL,
  "raw_article_id" TEXT NOT NULL,
  "candidate_story_id" TEXT,
  "resulting_story_id" TEXT,
  "match_score" INTEGER NOT NULL,
  "has_specific_shared_entity" INTEGER NOT NULL,
  "matched_entities" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("matched_entities")),
  "differing_entities" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("differing_entities")),
  "sport_mismatch" INTEGER NOT NULL DEFAULT 0,
  "decision" TEXT NOT NULL CHECK ("decision" IN ('auto_merge', 'needs_review', 'auto_new_story')),
  "decision_reason_hu" TEXT NOT NULL,
  "review_status" TEXT CHECK ("review_status" IN ('pending', 'approved_merge', 'approved_new_story')),
  "reviewed_by" TEXT,
  "review_note" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "resolved_at" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("candidate_story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("raw_article_id") REFERENCES "raw_articles" ("id") DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("resulting_story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "story_read_model" (
  "story_id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title_hu" TEXT NOT NULL,
  "lead_hu" TEXT NOT NULL,
  "body_html" TEXT NOT NULL,
  "meta_description" TEXT,
  "structured_data" TEXT CHECK (json_valid("structured_data")),
  "sources_summary" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("sources_summary")),
  "tags" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("tags")),
  "category" TEXT CHECK (json_valid("category")),
  "confidence_score" TEXT,
  "is_developing" INTEGER NOT NULL DEFAULT 0,
  "published_at" TEXT NOT NULL,
  "last_updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "version_history_summary" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("version_history_summary")),
  "is_ai_generated" INTEGER NOT NULL DEFAULT 1,
  "image_url" TEXT,
  "credibility_summary" TEXT CHECK (json_valid("credibility_summary")),
  "inline_images" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("inline_images")),
  PRIMARY KEY ("story_id"),
  UNIQUE ("slug"),
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "story_sources" (
  "id" TEXT NOT NULL,
  "story_id" TEXT NOT NULL,
  "raw_article_id" TEXT NOT NULL,
  "contribution_type" TEXT NOT NULL CHECK ("contribution_type" IN ('initial', 'corroboration', 'new_info', 'contradiction', 'possible_duplicate')),
  "linked_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "excluded" INTEGER NOT NULL DEFAULT 0,
  "excluded_reason" TEXT,
  PRIMARY KEY ("id"),
  UNIQUE ("story_id", "raw_article_id"),
  FOREIGN KEY ("raw_article_id") REFERENCES "raw_articles" ("id") DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "story_tags" (
  "story_id" TEXT NOT NULL,
  "tag_id" TEXT NOT NULL,
  PRIMARY KEY ("story_id", "tag_id"),
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("tag_id") REFERENCES "tags" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "story_versions" (
  "id" TEXT NOT NULL,
  "story_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "title_hu" TEXT NOT NULL,
  "lead_hu" TEXT NOT NULL,
  "body_hu" TEXT NOT NULL,
  "meta_description" TEXT,
  "seo_tags" TEXT CHECK (json_valid("seo_tags")),
  "structured_data" TEXT CHECK (json_valid("structured_data")),
  "change_summary_hu" TEXT,
  "generated_by_model" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "fact_consistency_score" TEXT,
  "is_published" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "is_ai_generated" INTEGER NOT NULL DEFAULT 1,
  "quality_issues" TEXT CHECK (json_valid("quality_issues")),
  "editorial_rewrite_applied" INTEGER NOT NULL DEFAULT 0,
  "self_check_fallback" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("id"),
  UNIQUE ("story_id", "version_number"),
  FOREIGN KEY ("story_id") REFERENCES "stories" ("id") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "tags" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name_hu" TEXT NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("slug")
);

CREATE UNIQUE INDEX "editorial_corrections_portable_key_idx" ON "editorial_corrections" (portable_key);

CREATE INDEX "editorial_knowledge_entries_retrieval_idx" ON "editorial_knowledge_entries" (status, sport, source_language, target_language, knowledge_type);

CREATE UNIQUE INDEX "editorial_knowledge_entries_stable_key_idx" ON "editorial_knowledge_entries" (stable_key);

CREATE INDEX "editorial_knowledge_import_runs_digest_idx" ON "editorial_knowledge_import_runs" (package_digest);

CREATE INDEX "editorial_knowledge_import_runs_package_idx" ON "editorial_knowledge_import_runs" (package_id, package_version);

CREATE UNIQUE INDEX "knowledge_review_patterns_key_idx" ON "knowledge_review_patterns" (pattern_key);

CREATE UNIQUE INDEX "missed_merge_reviews_pair_idx" ON "missed_merge_reviews" (story_a_id, story_b_id);

CREATE INDEX "pipeline_jobs_status_available_at_idx" ON "pipeline_jobs" (status, available_at);

CREATE UNIQUE INDEX "raw_articles_source_guid_unique" ON "raw_articles" (source_id, json_extract(extracted_entities, '$.rssGuid'));

CREATE UNIQUE INDEX "raw_articles_source_url_unique" ON "raw_articles" (source_id, source_url);

CREATE INDEX "story_match_decisions_decision_review_status_idx" ON "story_match_decisions" (decision, review_status);

CREATE INDEX "story_match_decisions_raw_article_id_idx" ON "story_match_decisions" (raw_article_id);

CREATE INDEX "raw_articles_processing_due_idx" ON "raw_articles" (processing_status,processing_available_at);

-- PostgreSQL GIN indexes above require a separate D1 JSON search plan.
