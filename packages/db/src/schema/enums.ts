import {
  REVIEW_QUEUE_REASONS,
  REVIEW_QUEUE_STATUSES,
  RISK_LEVELS,
  SOURCE_CATEGORIES,
  SOURCE_CONTENT_MODES,
  SOURCE_RELIABILITY_TIERS,
  STORY_MATCH_DECISIONS,
  STORY_MATCH_REVIEW_STATUSES,
  STORY_SOURCE_CONTRIBUTION_TYPES,
  STORY_STATUSES,
} from "@magyarsportonline/shared";
import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Postgres enum types, derived from the single source of truth in
 * @magyarsportonline/shared so the DB schema and the event-contract
 * package (packages/events) can never drift apart on allowed values.
 */

export const storyStatusEnum = pgEnum("story_status", STORY_STATUSES);
export const riskLevelEnum = pgEnum("risk_level", RISK_LEVELS);
export const storySourceContributionTypeEnum = pgEnum(
  "story_source_contribution_type",
  STORY_SOURCE_CONTRIBUTION_TYPES,
);
export const sourceReliabilityTierEnum = pgEnum(
  "source_reliability_tier",
  SOURCE_RELIABILITY_TIERS,
);
export const reviewQueueReasonEnum = pgEnum("review_queue_reason", REVIEW_QUEUE_REASONS);
export const reviewQueueStatusEnum = pgEnum("review_queue_status", REVIEW_QUEUE_STATUSES);
export const storyMatchDecisionEnum = pgEnum("story_match_decision", STORY_MATCH_DECISIONS);
export const storyMatchReviewStatusEnum = pgEnum(
  "story_match_review_status",
  STORY_MATCH_REVIEW_STATUSES,
);

export const sourceCategoryEnum = pgEnum("source_category", SOURCE_CATEGORIES);
export const sourceContentModeEnum = pgEnum("source_content_mode", SOURCE_CONTENT_MODES);

/**
 * "scraper" a korábbi, egyetlen-forrásos MVP maradványa — egyetlen seed sor
 * sem használja (ellenőrizve), de a Postgres enum-értékek biztonságos
 * eltávolítása táblaátírást igényelne, ezért csak deprecate-eljük, nem
 * töröljük. A 2026-07-28-i többforrásos irány "elérési mód" taxonómiája
 * (api/rss/html/social-embed) mostantól "html"-t és "social_embed"-et használ
 * "scraper" helyett.
 */
export const sourceTypeEnum = pgEnum("source_type", [
  "rss",
  "api",
  "scraper",
  "html",
  "social_embed",
]);
/**
 * "pending_review" a 2026-07-28-i többforrásos irány által hozzáadott új
 * érték — olyan forrásokhoz kell, amiket dokumentáltunk (docs/source-registry.md),
 * de robots.txt/ToS élő ellenőrzése még nem történt meg, ezért `is_active`
 * még `false` marad, amíg a jogi/technikai audit le nem zajlik.
 */
export const sourceLicenseTypeEnum = pgEnum("source_license_type", [
  "public_rss",
  "licensed_api",
  "scrape_allowed",
  "pending_review",
]);
export const ingestStatusEnum = pgEnum("ingest_status", ["ingested", "deduped", "merged", "error"]);
export const entityTypeEnum = pgEnum("entity_type", [
  "player",
  "coach",
  "team",
  "competition",
  "league",
  "venue",
]);
export const storyEntityRoleEnum = pgEnum("story_entity_role", [
  "subject",
  "opponent",
  "mentioned",
]);
export const factTypeEnum = pgEnum("fact_type", [
  "score",
  "quote",
  "injury_status",
  "transfer_status",
  "event_time",
  "other",
]);
export const socialPlatformEnum = pgEnum("social_platform", ["facebook", "threads", "x"]);
export const socialPostStatusEnum = pgEnum("social_post_status", [
  "queued",
  "posting",
  "posted",
  "failed",
  "retracted",
]);
export const agentRunStatusEnum = pgEnum("agent_run_status", ["success", "error", "skipped"]);
/**
 * A `pipeline_jobs` (2026-07-29, aszinkron pipeline sprint) állapotgépe —
 * lásd packages/db/src/schema/pipeline-jobs.ts megjegyzését a teljes
 * indoklásért. Szándékosan nincs külön "failed" állapot: egy sikertelen,
 * de még újrapróbálható job visszakerül "pending"-be (jövőbeli
 * `available_at`-tal, `attempts`/`last_error` jelzi a történetét) — csak a
 * `max_attempts`-ot elért, VÉGLEGESEN sikertelen job kap "dead_letter"-t,
 * ami admin/observability célból megmarad, nem tűnik el.
 */
export const pipelineJobStatusEnum = pgEnum("pipeline_job_status", [
  "pending",
  "in_progress",
  "completed",
  "dead_letter",
]);
