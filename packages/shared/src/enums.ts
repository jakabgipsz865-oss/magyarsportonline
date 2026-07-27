/**
 * Central enum definitions shared between `packages/db` (schema) and
 * `packages/events` (event payload validation), so the two never drift apart.
 * Source of truth: docs/architecture/01-data-model.md.
 */

export const STORY_STATUSES = [
  "draft",
  "fact_checked",
  "written",
  "seo_ready",
  "pending_review",
  "published",
  "updated",
  "retracted",
] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const STORY_SOURCE_CONTRIBUTION_TYPES = [
  "initial",
  "corroboration",
  "new_info",
  "contradiction",
  "possible_duplicate",
] as const;
export type StorySourceContributionType =
  (typeof STORY_SOURCE_CONTRIBUTION_TYPES)[number];

export const SOURCE_RELIABILITY_TIERS = ["A", "B", "C"] as const;
export type SourceReliabilityTier = (typeof SOURCE_RELIABILITY_TIERS)[number];

export const REVIEW_QUEUE_REASONS = [
  "high_risk",
  "contradiction",
  "low_confidence",
  "manual_flag",
  "single_source_sensitive_category",
  "prompt_injection_suspected",
] as const;
export type ReviewQueueReason = (typeof REVIEW_QUEUE_REASONS)[number];

export const REVIEW_QUEUE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "edited",
] as const;
export type ReviewQueueStatus = (typeof REVIEW_QUEUE_STATUSES)[number];
