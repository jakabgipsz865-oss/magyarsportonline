/**
 * Cost-tiered model selection (docs/architecture/02-agents.md §2.4, §2.5:
 * "extrakció: gyors/olcsó modell; végső magyar szövegezés: erősebb modell").
 * Full model-tiering config (`packages/llm/model-router.ts` per
 * docs/architecture/05-repo-structure.md) is roadmap Fázis 12, step 97 — this
 * is the minimal, hardcoded version needed for the MVP's two agents.
 */
export const MODEL_TIERS = {
  /** Fact Verification Agent: structured extraction from a single RawArticle. */
  extraction: "claude-haiku-4-5",
  /** Hungarian Writer Agent: self-check pass against the Fact set. */
  selfCheck: "claude-haiku-4-5",
  /** Hungarian Writer Agent: final Hungarian title/lead/body generation. */
  writing: "claude-sonnet-5",
} as const;
