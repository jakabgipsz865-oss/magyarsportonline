/**
 * USD / 1M token árak az általunk használt modellekhez (model-router.ts).
 * Forrás: Anthropic API árlista. Ismeretlen modellre szándékosan a
 * legdrágább ismert tier árával számolunk (konzervatív felülbecslés), hogy
 * a budget-plafon (budget-guard.ts) sose becsülje alá a tényleges költést.
 */
export interface ModelPricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5": { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  "claude-sonnet-5": { inputUsdPerMTok: 3, outputUsdPerMTok: 15 },
};

/** Konzervatív fallback ismeretlen modell-ID-re — Opus-tier árszint. */
export const UNKNOWN_MODEL_PRICING: ModelPricing = {
  inputUsdPerMTok: 15,
  outputUsdPerMTok: 75,
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? UNKNOWN_MODEL_PRICING;
  return (
    (inputTokens * pricing.inputUsdPerMTok + outputTokens * pricing.outputUsdPerMTok) / 1_000_000
  );
}
