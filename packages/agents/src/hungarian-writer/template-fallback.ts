import type { FactType } from "@magyarsportonline/shared";

export interface TemplateFallbackFact {
  factType: FactType;
  payload: unknown;
}

export interface TemplateFallbackOutput {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
  changeSummaryHu: string;
}

/**
 * Deterministic, NOT-AI-generated fallback used only when
 * `ANTHROPIC_API_KEY` is unset (docs/adr/0007-mvp-llm-fallback-mode.md).
 * Renders plain Hungarian sentences directly from the verified `Fact` rows
 * — no free-form language generation, so there is nothing to hallucinate.
 * Callers must record `generatedByModel: "template-fallback-v1"` so this is
 * never mistaken for AI output downstream.
 */
export function renderTemplateFallback(
  input: { canonicalTitle: string; facts: TemplateFallbackFact[] },
  isUpdate: boolean,
): TemplateFallbackOutput {
  const scoreFact = input.facts.find((f) => f.factType === "score");
  const quoteFacts = input.facts.filter((f) => f.factType === "quote");

  const scorePayload = scoreFact?.payload as { home?: number; away?: number } | undefined;
  const leadHu =
    scorePayload?.home !== undefined && scorePayload.away !== undefined
      ? `A mérkőzés végeredménye ${scorePayload.home}-${scorePayload.away} lett.`
      : "A mérkőzés részletei egyelőre nem ismertek.";

  const quoteSentences = quoteFacts.map((fact) => {
    const payload = fact.payload as { text?: string; speaker?: string };
    const speaker = payload.speaker ?? "az egyik érintett";
    return `${speaker} így nyilatkozott: "${payload.text ?? ""}"`;
  });

  const bodyHu = [leadHu, ...quoteSentences].join(" ");
  const changeSummaryHu = isUpdate
    ? "Új információval frissült a Story (sablon-alapú, nem AI-generált automatikus frissítés)."
    : "Kezdeti verzió (sablon-alapú, nem AI-generált automatikus szöveg).";

  return { titleHu: input.canonicalTitle, leadHu, bodyHu, changeSummaryHu };
}
