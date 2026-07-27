import { MODEL_TIERS, type LlmClient } from "@magyarsportonline/llm";
import { z } from "zod";
import type { WriterFact } from "./facts";

const SELF_CHECK_JSON_SCHEMA = {
  type: "object",
  properties: {
    consistent: { type: "boolean" },
    fact_consistency_score: { type: "number" },
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["consistent", "fact_consistency_score", "issues"],
  additionalProperties: false,
} as const;

const selfCheckResponseSchema = z.object({
  consistent: z.boolean(),
  fact_consistency_score: z.number().min(0).max(1),
  issues: z.array(z.string()),
});

export interface SelfCheckInput {
  facts: WriterFact[];
  titleHu: string;
  leadHu: string;
  bodyHu: string;
}

export interface SelfCheckResult {
  consistent: boolean;
  factConsistencyScore: number;
  issues: string[];
}

const SYSTEM_PROMPT = `Tényellenőr vagy. A felhasználói üzenet egy JSON "facts" tömböt és egy legenerált magyar nyelvű "title_hu"/"lead_hu"/"body_hu" hírszöveget tartalmaz. Ellenőrizd MONDATRÓL MONDATRA, hogy a szöveg minden állítása alátámasztható-e a "facts" tömbben szereplő tényekkel.

- "consistent": false, ha a szövegben van OLYAN állítás, ami nincs a tények között (hallucináció) vagy ellentmond egyténynek.
- "fact_consistency_score": 0.0-1.0 közötti szám, 1.0 = tökéletes egyezés.
- "issues": rövid, magyar nyelvű lista a talált problémákról (üres tömb, ha nincs probléma).`;

/** Hungarian Writer Agent's self-check step (docs/architecture/02-agents.md §2.5): a second, cheaper LLM call re-verifies the generated text against the Fact set. */
export async function selfCheckContent(
  llm: LlmClient,
  input: SelfCheckInput,
): Promise<SelfCheckResult> {
  const result = await llm.completeJson({
    model: MODEL_TIERS.selfCheck,
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
    maxTokens: 1024,
    jsonSchema: SELF_CHECK_JSON_SCHEMA,
  });

  const parsed = selfCheckResponseSchema.parse(result.data);
  return {
    consistent: parsed.consistent,
    factConsistencyScore: parsed.fact_consistency_score,
    issues: parsed.issues,
  };
}
