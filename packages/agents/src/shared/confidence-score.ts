import type { SourceReliabilityTier } from "@magyarsportonline/shared";

export interface ConfidenceScoreInput {
  /** Distinct contributing Source count (docs/architecture/01-data-model.md §1.4). */
  independentSourceCount: number;
  /** One tier per distinct contributing source. */
  reliabilityTiers: SourceReliabilityTier[];
  contradictionCount: number;
  isDeveloping: boolean;
}

const RELIABILITY_TIER_SCORE: Record<SourceReliabilityTier, number> = {
  A: 1.0,
  B: 0.7,
  C: 0.4,
};

function sourceCorroborationScore(independentSourceCount: number): number {
  if (independentSourceCount <= 0) return 0;
  if (independentSourceCount === 1) return 0.3;
  if (independentSourceCount === 2) return 0.6;
  return Math.min(1, 0.9 + 0.05 * (independentSourceCount - 3));
}

function sourceReliabilityScore(tiers: SourceReliabilityTier[]): number {
  if (tiers.length === 0) return 0;
  const sum = tiers.reduce((acc, tier) => acc + RELIABILITY_TIER_SCORE[tier], 0);
  return sum / tiers.length;
}

function factConsistencyScore(contradictionCount: number): number {
  return Math.max(0, 1 - 0.3 * contradictionCount);
}

/**
 * MVP simplification: the architecture (docs/architecture/01-data-model.md
 * §1.4) only says fresh/developing stories "get a lower weight until they
 * stabilize" without prescribing an exact number — 0.6 vs. 1.0 is a
 * reasonable, documented placeholder pending real-world calibration, not a
 * deviation requiring an ADR (the doc itself leaves this open).
 */
function recencyScore(isDeveloping: boolean): number {
  return isDeveloping ? 0.6 : 1.0;
}

/** Implements the weighted formula from docs/architecture/01-data-model.md §1.4. */
export function computeConfidenceScore(input: ConfidenceScoreInput): number {
  const score =
    0.35 * sourceCorroborationScore(input.independentSourceCount) +
    0.25 * sourceReliabilityScore(input.reliabilityTiers) +
    0.25 * factConsistencyScore(input.contradictionCount) +
    0.15 * recencyScore(input.isDeveloping);

  return Math.max(0, Math.min(1, score));
}
