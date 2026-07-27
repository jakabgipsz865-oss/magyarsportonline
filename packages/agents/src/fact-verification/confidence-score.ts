import type { SourceReliabilityTier } from "@magyarsportonline/shared";

const RELIABILITY_WEIGHT: Record<SourceReliabilityTier, number> = {
  A: 1.0,
  B: 0.7,
  C: 0.4,
};

export interface ConfidenceScoreInput {
  sourceCount: number;
  reliabilityTiers: SourceReliabilityTier[];
  hasContradiction: boolean;
  isDeveloping: boolean;
}

function sourceCorroborationScore(sourceCount: number): number {
  if (sourceCount >= 3) return 1.0;
  if (sourceCount === 2) return 0.6;
  return 0.3;
}

function sourceReliabilityScore(tiers: SourceReliabilityTier[]): number {
  if (tiers.length === 0) return 0.5;
  const sum = tiers.reduce((total, tier) => total + RELIABILITY_WEIGHT[tier], 0);
  return sum / tiers.length;
}

/**
 * Confidence Score formula (docs/architecture/01-data-model.md §1.4):
 *   0.35 * source_corroboration_score
 * + 0.25 * source_reliability_score
 * + 0.25 * fact_consistency_score
 * + 0.15 * recency_score
 */
export function computeConfidenceScore(input: ConfidenceScoreInput): number {
  const corroboration = sourceCorroborationScore(input.sourceCount);
  const reliability = sourceReliabilityScore(input.reliabilityTiers);
  const consistency = input.hasContradiction ? 0.5 : 1.0;
  const recency = input.isDeveloping ? 0.6 : 1.0;

  const score = 0.35 * corroboration + 0.25 * reliability + 0.25 * consistency + 0.15 * recency;
  return Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000;
}
