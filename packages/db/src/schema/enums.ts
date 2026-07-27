import {
  REVIEW_QUEUE_REASONS,
  REVIEW_QUEUE_STATUSES,
  RISK_LEVELS,
  SOURCE_RELIABILITY_TIERS,
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

export const sourceTypeEnum = pgEnum("source_type", ["rss", "api", "scraper"]);
export const sourceLicenseTypeEnum = pgEnum("source_license_type", [
  "public_rss",
  "licensed_api",
  "scrape_allowed",
]);
export const ingestStatusEnum = pgEnum("ingest_status", ["ingested", "deduped", "merged", "error"]);
export const entityTypeEnum = pgEnum("entity_type", [
  "player",
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
