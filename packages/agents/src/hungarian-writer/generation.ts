import { MODEL_TIERS, type LlmClient } from "@magyarsportonline/llm";
import { z } from "zod";
import type { WriterFact } from "./facts";

const GENERATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    title_hu: { type: "string" },
    lead_hu: { type: "string" },
    body_hu: { type: "string" },
    change_summary_hu: { type: ["string", "null"] },
  },
  required: ["title_hu", "lead_hu", "body_hu", "change_summary_hu"],
  additionalProperties: false,
} as const;

const generationResponseSchema = z.object({
  title_hu: z.string(),
  lead_hu: z.string(),
  body_hu: z.string(),
  change_summary_hu: z.string().nullable(),
});

export interface PreviousVersionContent {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
}

export interface GenerationInput {
  facts: WriterFact[];
  previousVersion: PreviousVersionContent | null;
}

export interface GeneratedContent {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
  changeSummaryHu: string | null;
}

const SYSTEM_PROMPT = `Magyar sportújságíró vagy. Kizárólag a felhasználói üzenetben JSON-ként megadott "facts" tömbre támaszkodva írj eredeti, magyar nyelvű hírt — SOSEM fordítás, és SOSEM tartalmazhat olyan állítást, ami nincs a tények között. Ha egy infó hiányzik, ne találd ki.

Szabályok:
- "title_hu": rövid, tényszerű cím.
- "lead_hu": 1-2 mondatos bevezető.
- "body_hu": a törzsszöveg, kizárólag a megadott tényekre építve.
- Szó szerinti idézetet KIZÁRÓLAG akkor használj, ha egy tény "factType" mezője "quote", és akkor is csak a megadott "quoteOriginal"/"quoteSpeaker" alapján, forrás-hivatkozással.
- Ha a felhasználói üzenet "previousVersion" mezője nem null, a "change_summary_hu" mezőben egy rövid, magyar nyelvű összefoglalót adj arról, mi változott az előző verzióhoz képest. Ha "previousVersion" null (ez az első verzió), a "change_summary_hu" legyen null.`;

/** Hungarian Writer Agent's generation step (docs/architecture/02-agents.md §2.5) — Facts only, never raw source text. */
export async function generateStoryVersion(
  llm: LlmClient,
  input: GenerationInput,
): Promise<GeneratedContent> {
  const result = await llm.completeJson({
    model: MODEL_TIERS.writing,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify({ facts: input.facts, previousVersion: input.previousVersion }),
      },
    ],
    maxTokens: 2048,
    jsonSchema: GENERATION_JSON_SCHEMA,
  });

  const parsed = generationResponseSchema.parse(result.data);
  return {
    titleHu: parsed.title_hu,
    leadHu: parsed.lead_hu,
    bodyHu: parsed.body_hu,
    changeSummaryHu: parsed.change_summary_hu,
  };
}
