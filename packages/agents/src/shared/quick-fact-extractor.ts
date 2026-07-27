import type { FactType } from "@magyarsportonline/shared";

export interface QuickFact {
  factType: Extract<FactType, "score" | "quote">;
  payload: Record<string, unknown>;
}

const SCORE_PATTERN = /(\d{1,2})\s*[-–—]\s*(\d{1,2})/;
const QUOTE_PATTERN = /"([^"]{5,300})"/;

/**
 * Cheap, non-LLM regex extraction — NOT a replacement for the Fact
 * Verification Agent's LLM-based extraction. Used for two things that both
 * need a fast signal without paying for a full LLM call:
 *
 * 1. The Story Merge Agent's "corroboration vs. new_info" diff
 *    (docs/architecture/02-agents.md §2.3, docs/architecture/09-architecture-review.md
 *    §7 extraction-cap rule) — deciding whether an incoming RawArticle
 *    carries anything not already known BEFORE the expensive extraction
 *    step runs.
 * 2. The Fact Verification Agent's fallback path when no
 *    `ANTHROPIC_API_KEY` is configured (docs/adr/0007-mvp-llm-fallback-mode.md).
 */
export function extractQuickFacts(text: string): QuickFact[] {
  const facts: QuickFact[] = [];

  const scoreMatch = SCORE_PATTERN.exec(text);
  if (scoreMatch?.[1] !== undefined && scoreMatch[2] !== undefined) {
    facts.push({
      factType: "score",
      payload: {
        raw: scoreMatch[0],
        home: Number(scoreMatch[1]),
        away: Number(scoreMatch[2]),
      },
    });
  }

  const quoteMatch = QUOTE_PATTERN.exec(text);
  if (quoteMatch?.[1] !== undefined) {
    facts.push({ factType: "quote", payload: { text: quoteMatch[1].trim() } });
  }

  return facts;
}
