import { MODEL_TIERS, type LlmClient } from "@magyarsportonline/llm";
import { z } from "zod";
import type { WriterFact } from "../hungarian-writer/facts";
import { EDITORIAL_STYLE_GUIDE } from "./style-guide";

const REWRITE_JSON_SCHEMA = {
  type: "object",
  properties: {
    rewritten_title_hu: { type: "string" },
    rewritten_lead_hu: { type: "string" },
    rewritten_body_hu: { type: "string" },
  },
  required: ["rewritten_title_hu", "rewritten_lead_hu", "rewritten_body_hu"],
  additionalProperties: false,
} as const;

const rewriteResponseSchema = z.object({
  rewritten_title_hu: z.string(),
  rewritten_lead_hu: z.string(),
  rewritten_body_hu: z.string(),
});

export interface EditorialRewriteInput {
  facts: WriterFact[];
  titleHu: string;
  leadHu: string;
  bodyHu: string;
}

export interface EditorialRewriteResult {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
  /** true when this came from a fallback client (NoLlmClient or a wrapped provider's fallback branch) — content is an identity passthrough, not a real rewrite. */
  isFallback: boolean;
}

const SYSTEM_PROMPT = `${EDITORIAL_STYLE_GUIDE}

A felhasználói üzenet egy JSON "facts" tömböt (a hír mögötti, ellenőrzött tények — ehhez képest kell tényhűnek maradnod) és a jelenlegi "title_hu"/"lead_hu"/"body_hu" mezőket tartalmazza. Add vissza a stilizált változatot "rewritten_title_hu"/"rewritten_lead_hu"/"rewritten_body_hu" mezőkben.`;

/**
 * Editorial Rewrite Agent's LLM call: takes the Hungarian Writer Agent's
 * already fact-checked title/lead/body and asks for a stylistic-only pass
 * (docs/editorial-style-guide.md). The caller (index.ts) is responsible for
 * re-verifying fact consistency on the result and discarding it if the
 * rewrite drifted — this function only produces a candidate, it does not
 * decide whether the candidate is safe to keep.
 */
export async function rewriteForStyle(
  llm: LlmClient,
  input: EditorialRewriteInput,
): Promise<EditorialRewriteResult> {
  const result = await llm.completeJson({
    model: MODEL_TIERS.editorialRewrite,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          facts: input.facts,
          title_hu: input.titleHu,
          lead_hu: input.leadHu,
          body_hu: input.bodyHu,
        }),
      },
    ],
    maxTokens: 2048,
    jsonSchema: REWRITE_JSON_SCHEMA,
  });

  const parsed = rewriteResponseSchema.parse(result.data);
  return {
    titleHu: parsed.rewritten_title_hu,
    leadHu: parsed.rewritten_lead_hu,
    bodyHu: parsed.rewritten_body_hu,
    isFallback: result.isFallback ?? false,
  };
}
