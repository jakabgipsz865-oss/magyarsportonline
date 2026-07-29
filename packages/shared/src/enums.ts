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
export type StorySourceContributionType = (typeof STORY_SOURCE_CONTRIBUTION_TYPES)[number];

export const SOURCE_RELIABILITY_TIERS = ["A", "B", "C"] as const;
export type SourceReliabilityTier = (typeof SOURCE_RELIABILITY_TIERS)[number];

/**
 * Source Registry kategória (2026-07-28-i többforrásos irány,
 * docs/source-registry.md) — kinek a hangja a forrás: a klubé/ligáé saját
 * maga, egy bizalmi médiáé, egy bulvárlapé, egy közösségi posztoé, vagy egy
 * strukturált adat-API-é. Használva a hitelességi pontszámításban (hivatalos
 * forrás súlya) és a discovery/fact-extraction döntésben.
 */
export const SOURCE_CATEGORIES = [
  "official",
  "league",
  "club",
  "trusted_media",
  "tabloid",
  "social",
  "data_api",
] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

/**
 * Mire használjuk a forrás tartalmát: `full_text` = a teljes cikktörzs
 * felhasználható a magyar Story megírásához (Source Fetcher célja);
 * `fact_only` = csak konkrét állítások (pl. eredmény, idézet) kinyerésére
 * használjuk, a szöveg maga nem; `discovery_only` = csak arra jó, hogy
 * felfedezzünk vele egy történést, a tartalmát sosem használjuk fel
 * (pl. egy közösségi poszt, ami csak jelzi, hogy történt valami).
 */
export const SOURCE_CONTENT_MODES = ["full_text", "fact_only", "discovery_only"] as const;
export type SourceContentMode = (typeof SOURCE_CONTENT_MODES)[number];

export const REVIEW_QUEUE_REASONS = [
  "high_risk",
  "contradiction",
  "low_confidence",
  "manual_flag",
  "single_source_sensitive_category",
  "prompt_injection_suspected",
  "content_quality_failed",
  "force_review_mode",
] as const;
export type ReviewQueueReason = (typeof REVIEW_QUEUE_REASONS)[number];

export const REVIEW_QUEUE_STATUSES = ["pending", "approved", "rejected", "edited"] as const;
export type ReviewQueueStatus = (typeof REVIEW_QUEUE_STATUSES)[number];

/**
 * Story matching decision outcomes (2026-07-29, "téves Story-összevonás
 * megszüntetése" sprint, packages/agents/src/deduplication/story-match.ts):
 * `auto_merge` requires at least one specific (team/player) shared entity
 * plus enough corroboration; `needs_review` has a specific shared entity
 * but not enough corroboration to auto-merge, so it does NOT merge and
 * becomes its own Story pending manual review; `auto_new_story` covers
 * everything else, including a competition/league-only match (never
 * sufficient on its own — see docs/open-decisions.md #12 follow-up on the
 * real 16-article false-merge this replaces).
 */
export const STORY_MATCH_DECISIONS = ["auto_merge", "needs_review", "auto_new_story"] as const;
export type StoryMatchDecisionKind = (typeof STORY_MATCH_DECISIONS)[number];

export const STORY_MATCH_REVIEW_STATUSES = [
  "pending",
  "approved_merge",
  "approved_new_story",
] as const;
export type StoryMatchReviewStatus = (typeof STORY_MATCH_REVIEW_STATUSES)[number];
