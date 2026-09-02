import { MODEL_TIERS, type LlmClient } from "@magyarsportonline/llm";
import { z } from "zod";
import type { WriterFact } from "./facts";

const SELF_CHECK_JSON_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sentence_id: { type: "string" },
          supported: { type: "boolean" },
          supporting_fact_ids: { type: "array", items: { type: "string" } },
          issue: { type: ["string", "null"] },
        },
        required: ["sentence_id", "supported", "supporting_fact_ids", "issue"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
} as const;

const selfCheckResponseSchema = z.object({
  verdicts: z.array(
    z.object({
      sentence_id: z.string(),
      supported: z.boolean(),
      supporting_fact_ids: z.array(z.string()),
      issue: z.string().nullable(),
    }),
  ),
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
  sentenceVerdicts: SelfCheckSentenceVerdict[];
  /** true, ha ez a válasz egy LLM-hiba miatti fallback-válaszból származik — lásd generation.ts GeneratedContent.isFallback. */
  isFallback: boolean;
}

export interface SelfCheckSentenceVerdict {
  sentenceId: string;
  sentence: string;
  supported: boolean;
  supportingFactIds: string[];
  issue: string | null;
}

export function segmentArticleSentences(input: Omit<SelfCheckInput, "facts">) {
  const parts = [input.titleHu, input.leadHu, input.bodyHu]
    .flatMap((text) => text.split(/(?<=[.!?])\s+|\n+/u))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return parts.map((sentence, index) => ({ id: `S${index + 1}`, sentence }));
}

const SYSTEM_PROMPT = `Tényellenőr vagy. A felhasználói üzenet stabil azonosítójú "facts" és "sentences" tömböt tartalmaz. Minden mondatra pontosan egy verdictet adj, és kizárólag létező Fact ID-kre hivatkozz.

Minden Fact angol "claimEn" állítást és a forrásból szó szerint megőrzött "evidenceOriginal" bizonyítékot tartalmaz. Az ellenőrzést mindkettőhöz végezd el; a magyar szöveget ne tekintsd igazoltnak pusztán attól, hogy egy claim megfogalmazása hasonló.

- "sentence_id": a kapott mondat változatlan ID-ja.
- "supported": csak akkor true, ha a mondat minden tényszerű állítását közvetlenül alátámasztja legalább egy megadott Fact.
- "supporting_fact_ids": az alátámasztó Fact ID-k; true verdictnél nem lehet üres.
- "issue": unsupported mondatnál konkrét, rövid magyar indok; supported mondatnál null.
Ne adj összesített score-t vagy consistent mezőt; ezeket az alkalmazás számolja.`;

/** Hungarian Writer Agent's self-check step (docs/architecture/02-agents.md §2.5): a second, cheaper LLM call re-verifies the generated text against the Fact set. */
export async function selfCheckContent(
  llm: LlmClient,
  input: SelfCheckInput,
): Promise<SelfCheckResult> {
  const sentences = segmentArticleSentences(input);
  const facts = input.facts.map((fact, index) => ({ ...fact, id: fact.id ?? `F${index + 1}` }));
  const result = await llm.completeJson({
    model: MODEL_TIERS.selfCheck,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          facts,
          sentences,
        }),
      },
    ],
    // Három rövid JSON-mező; a kisebb plafon közvetlenül korlátozza az
    // ellenőrző Cloudflare-hívás neuronfogyasztását.
    maxTokens: 512,
    jsonSchema: SELF_CHECK_JSON_SCHEMA,
  });

  const parsed = selfCheckResponseSchema.parse(result.data);
  const factIds = new Set(facts.map((fact) => fact.id));
  const verdictsById = new Map<string, typeof parsed.verdicts>();
  for (const verdict of parsed.verdicts) {
    verdictsById.set(verdict.sentence_id, [
      ...(verdictsById.get(verdict.sentence_id) ?? []),
      verdict,
    ]);
  }
  const hasUnknownSentence = parsed.verdicts.some(
    (verdict) => !sentences.some((sentence) => sentence.id === verdict.sentence_id),
  );
  const sentenceVerdicts = sentences.map<SelfCheckSentenceVerdict>((sentence, index) => {
    const matches = verdictsById.get(sentence.id) ?? [];
    const verdict = matches[0];
    const valid =
      matches.length === 1 &&
      verdict !== undefined &&
      verdict.supporting_fact_ids.every((id) => factIds.has(id)) &&
      (verdict.supported
        ? verdict.supporting_fact_ids.length > 0 && verdict.issue === null
        : Boolean(verdict.issue));
    const forceInvalid = hasUnknownSentence && index === 0;
    return {
      sentenceId: sentence.id,
      sentence: sentence.sentence,
      supported: valid && !forceInvalid ? verdict.supported : false,
      supportingFactIds: valid && !forceInvalid ? verdict.supporting_fact_ids : [],
      issue: valid && !forceInvalid ? verdict.issue : "missing_or_invalid_sentence_verdict",
    };
  });
  const supportedCount = sentenceVerdicts.filter((verdict) => verdict.supported).length;
  const factConsistencyScore =
    sentenceVerdicts.length > 0 ? supportedCount / sentenceVerdicts.length : 0;
  const issues = sentenceVerdicts
    .filter((verdict) => !verdict.supported)
    .map(
      (verdict) =>
        `${verdict.sentenceId}: ${verdict.issue} [supporting_fact_ids: ${verdict.supportingFactIds.join(",")}]`,
    );
  return {
    consistent: sentenceVerdicts.length > 0 && supportedCount === sentenceVerdicts.length,
    factConsistencyScore,
    issues,
    sentenceVerdicts,
    isFallback: result.isFallback ?? false,
  };
}
