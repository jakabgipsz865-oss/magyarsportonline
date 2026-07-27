/**
 * Modell-tiering (docs/architecture/07-scalability.md §7.3): olcsó/gyors
 * modell a nagy volumenű, mechanikus lépésekhez (extrakció, önellenőrzés),
 * erősebb modell a végfelhasználó felé kerülő magyar szövegezéshez.
 */
export const MODEL_EXTRACTION = "claude-haiku-4-5-20251001";
export const MODEL_WRITER = "claude-sonnet-5";
export const MODEL_SELF_CHECK = "claude-haiku-4-5-20251001";

/**
 * Hozzávetőleges USD ár 1M tokenre (input/output) — becslési célra, NEM
 * számlázási forrás. A pontos, mindenkori árat lásd
 * https://docs.anthropic.com/pricing — ismeretlen modellre a
 * költségbecslés `null`-t ad vissza ahelyett, hogy kitalálna egy számot.
 */
const PRICING_USD_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 3, output: 15 },
};

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const pricing = PRICING_USD_PER_MILLION_TOKENS[model];
  if (!pricing) {
    return null;
  }
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
