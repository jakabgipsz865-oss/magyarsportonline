import { MODEL_TIERS, type LlmClient } from "@magyarsportonline/llm";
import { z } from "zod";
import type { WriterFact } from "./facts";
import type { QualityIssue } from "./quality-gate";

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
  /** true, ha ez a tartalom egy LLM-hiba miatti fallback-válaszból (pl. Gemini kvótahiba) származik, nem valódi AI-generálásból — lásd LlmUsage.isFallback (client.ts). */
  isFallback: boolean;
}

const SYSTEM_PROMPT = `Magyar sportújságíró vagy. Kizárólag a felhasználói üzenetben JSON-ként megadott "facts" tömbre támaszkodva írj eredeti, magyar nyelvű hírt — SOSEM fordítás, és SOSEM tartalmazhat olyan állítást, ami nincs a tények között. Ha egy infó hiányzik, ne találd ki.

Szabályok:
- "title_hu": KÖTELEZŐEN teljes egészében MAGYAR nyelvű, rövid, tényszerű cím — akkor is, ha a "facts" tömbben szereplő "detail_hu" mezők bármelyike angolul van (ez hibás bemenet, de a kimeneted attól még legyen magyar). Sosem hagyhatsz angol szót vagy mondatrészt a címben, kivéve tulajdonneveket (csapat-, játékosnevek).
- "lead_hu": 1-2 mondatos bevezető, ugyanígy kötelezően magyarul.
- "body_hu": a törzsszöveg, kizárólag a megadott tényekre építve, kötelezően magyarul.
- Természetes, élő magyar sportújságírói stílust használj — ne fordíts szó szerint, ne másold be a "facts" szövegét változtatás nélkül; fogalmazz újra, kerüld az ismétlést és a gépies, monoton mondatszerkezetet.
- Ügyelj a magyar nyelvtanra: helyes névelőhasználat (a/az), ékezetek, ragozás és mondatszerkezet.
- Szó szerinti idézetet KIZÁRÓLAG akkor használj, ha egy tény "factType" mezője "quote", és akkor is csak a megadott "quoteOriginal"/"quoteSpeaker" alapján, forrás-hivatkozással.
- Ha a felhasználói üzenet "previousVersion" mezője nem null, a "change_summary_hu" mezőben egy rövid, magyar nyelvű összefoglalót adj arról, mi változott az előző verzióhoz képest. Ha "previousVersion" null (ez az első verzió), a "change_summary_hu" legyen null.`;

const QUALITY_FIX_SYSTEM_PROMPT = `Magyar sportújságíró vagy. Az előző tervezeted NEM felelt meg a minőségi elvárásoknak — a felhasználói üzenet "previousAttempt" mezője mutatja a hibás tervezetet, "issues" mezője pedig a talált problémákat (pl. "title: looks_english" = a cím angolul maradt; "lead: empty" = a lead üres; "body: matches_source_verbatim" = a törzs szó szerint megegyezik egy ténnyel).

Írd újra TELJESEN a "facts" tömbre támaszkodva:
- a cím, a lead és a törzs MINDEGYIKE teljes egészében MAGYAR nyelvű legyen (tulajdonnevek kivételével);
- egyik mező se maradjon üres;
- egyik mező se legyen szó szerint azonos egy "facts" bejegyzéssel — fogalmazz újra, természetes magyar sportújságírói stílusban;
- kerüld az ismétlést és a gépies megfogalmazást;
- ügyelj a helyes névelőkre, ékezetekre és mondatszerkezetre;
- kizárólag a "facts" tömbben szereplő tényekre támaszkodj, ne találj ki semmit.`;

async function runGenerationCall(
  llm: LlmClient,
  system: string,
  userContent: unknown,
): Promise<GeneratedContent> {
  const result = await llm.completeJson({
    model: MODEL_TIERS.writing,
    system,
    messages: [{ role: "user", content: JSON.stringify(userContent) }],
    maxTokens: 2048,
    jsonSchema: GENERATION_JSON_SCHEMA,
  });

  const parsed = generationResponseSchema.parse(result.data);
  return {
    titleHu: parsed.title_hu,
    leadHu: parsed.lead_hu,
    bodyHu: parsed.body_hu,
    changeSummaryHu: parsed.change_summary_hu,
    isFallback: result.isFallback ?? false,
  };
}

/** Hungarian Writer Agent's generation step (docs/architecture/02-agents.md §2.5) — Facts only, never raw source text. */
export async function generateStoryVersion(
  llm: LlmClient,
  input: GenerationInput,
): Promise<GeneratedContent> {
  return runGenerationCall(llm, SYSTEM_PROMPT, {
    facts: input.facts,
    previousVersion: input.previousVersion,
  });
}

export interface QualityFixInput extends GenerationInput {
  previousAttempt: { titleHu: string; leadHu: string; bodyHu: string };
  issues: QualityIssue[];
}

/**
 * Content Quality Gate's one allowed retry (Content Quality & Reliability
 * Hardening sprint): a single, targeted re-write call that tells the model
 * exactly what was wrong with its first attempt, instead of blindly
 * re-running the same prompt and hoping for a different result.
 */
export async function regenerateWithQualityFix(
  llm: LlmClient,
  input: QualityFixInput,
): Promise<GeneratedContent> {
  return runGenerationCall(llm, QUALITY_FIX_SYSTEM_PROMPT, {
    facts: input.facts,
    previousVersion: input.previousVersion,
    previousAttempt: input.previousAttempt,
    issues: input.issues.map((issue) => `${issue.field}: ${issue.kind}`),
  });
}
