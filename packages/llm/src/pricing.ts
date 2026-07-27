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

/**
 * Cloudflare Workers AI listaárak (a napi ingyenes Neuron-keret felett
 * érvényesülnének — az alkalmazás sosem kapcsol be Cloudflare billinget,
 * ez az érték kizárólag az `llm_usage` táblába kerülő becsült költséghez
 * kell, hogy a tényleges fogyasztás nyomon követhető legyen a napi ingyenes
 * keret közelségének megítéléséhez). Forrás: Cloudflare Workers AI árlista.
 */
export const CLOUDFLARE_MODEL_PRICING: Record<string, ModelPricing> = {
  "@cf/qwen/qwen3-30b-a3b-fp8": { inputUsdPerMTok: 0.051, outputUsdPerMTok: 0.34 },
};

/** Konzervatív fallback ismeretlen Cloudflare modell-ID-re. */
export const UNKNOWN_CLOUDFLARE_MODEL_PRICING: ModelPricing = {
  inputUsdPerMTok: 1,
  outputUsdPerMTok: 5,
};

export function estimateCloudflareCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = CLOUDFLARE_MODEL_PRICING[model] ?? UNKNOWN_CLOUDFLARE_MODEL_PRICING;
  return (
    (inputTokens * pricing.inputUsdPerMTok + outputTokens * pricing.outputUsdPerMTok) / 1_000_000
  );
}
