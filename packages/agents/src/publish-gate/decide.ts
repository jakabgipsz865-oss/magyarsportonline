import type { ReviewQueueReason, RiskLevel } from "@magyarsportonline/shared";

export const CONFIDENCE_THRESHOLD = 0.65;

export interface PublishGateInput {
  confidenceScore: number;
  riskLevel: RiskLevel;
  hasContradiction: boolean;
}

export type PublishGateDecision =
  | { decision: "auto_publish" }
  | { decision: "review_required"; reason: ReviewQueueReason };

/**
 * Deterministic Publish Gate rule (docs/architecture/02-agents.md §2.7) —
 * intentionally NOT an LLM call, so the publish/no-publish decision is
 * always explainable and testable. `riskLevel !== "low"` alone already
 * covers the review's hard rule for single-source + sensitive-category
 * Stories (docs/architecture/02-agents.md §2.4 kemény szabály): the
 * rule-based risk classifier returns "medium"/"high" for injury/death/
 * doping/legal keywords regardless of confidence, and this gate never
 * auto-publishes anything above "low" risk — so a sensitive-category Story
 * can never slip through on confidence score alone.
 */
export function decidePublishGate(input: PublishGateInput): PublishGateDecision {
  if (input.riskLevel !== "low") {
    return { decision: "review_required", reason: "high_risk" };
  }
  if (input.hasContradiction) {
    return { decision: "review_required", reason: "contradiction" };
  }
  if (input.confidenceScore < CONFIDENCE_THRESHOLD) {
    return { decision: "review_required", reason: "low_confidence" };
  }
  return { decision: "auto_publish" };
}
