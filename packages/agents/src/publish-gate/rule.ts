import type { ReviewQueueReason, RiskLevel, SourceCategory } from "@magyarsportonline/shared";

/** docs/architecture/02-agents.md §2.7: "confidence_score ≥ 0.65". */
export const CONFIDENCE_THRESHOLD = 0.65;

export interface PublishDecisionInput {
  riskLevel: RiskLevel;
  confidenceScore: number;
  hasContradiction: boolean;
  /** Hungarian Writer's Content Quality Gate found unfixed issues (empty/English/source-verbatim title, lead or body) — never auto-publish this, regardless of confidence/risk. */
  hasQualityIssues?: boolean;
  /** Operational kill switch (Content Quality & Reliability Hardening sprint): route every decision to review, no matter how confident — see apps/web/lib/env.ts FORCE_REVIEW_MODE. */
  forceReviewMode?: boolean;
  publicationReady?: boolean;
  singleSource?: {
    count: number;
    category: SourceCategory | null;
  };
}

export type PublishDecision =
  | { autoPublish: true }
  | { autoPublish: false; reason: ReviewQueueReason };

/**
 * Publish Gate's deterministic rule (docs/architecture/02-agents.md §2.7):
 * `risk_level=low` AND `confidence_score ≥ 0.65` AND `has_contradiction=false`
 * → auto-publish; anything else → review queue. Deliberately rule-based, no
 * LLM call, so the decision is always explainable and testable.
 *
 * The "sensitive category + single source never auto-publishes" hard rule
 * doesn't need a separate check here — the Fact Verification Agent already
 * folds that condition into `risk_level=high` (see fact-verification/risk-classifier.ts),
 * so this rule's `risk_level=low` requirement already excludes it.
 *
 * Note: this MVP always evaluates the rule live — the roadmap's Fázis 9
 * "soft launch" `FORCE_REVIEW_MODE` (route everything to review regardless
 * of this rule, for the first 1-2 weeks of a real launch) is an operational
 * toggle for going live, not applicable to local dev/demo runs.
 */
export function decidePublish(input: PublishDecisionInput): PublishDecision {
  if (input.hasQualityIssues) {
    return { autoPublish: false, reason: "content_quality_failed" };
  }
  if (input.forceReviewMode) {
    return { autoPublish: false, reason: "force_review_mode" };
  }
  if (input.riskLevel !== "low") {
    return { autoPublish: false, reason: "high_risk" };
  }
  if (input.hasContradiction) {
    return { autoPublish: false, reason: "contradiction" };
  }
  const singleSourceException =
    input.publicationReady === true &&
    input.singleSource?.count === 1 &&
    (input.singleSource.category === "tabloid" ||
      input.singleSource.category === "trusted_media") &&
    input.confidenceScore >= 0.5;
  if (input.confidenceScore < CONFIDENCE_THRESHOLD && !singleSourceException) {
    return { autoPublish: false, reason: "low_confidence" };
  }
  return { autoPublish: true };
}
