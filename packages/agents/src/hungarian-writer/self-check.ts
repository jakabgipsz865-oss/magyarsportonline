import { MODEL_TIERS, type LlmClient } from "@magyarsportonline/llm";
import { z } from "zod";
import type { WriterFact } from "./facts";
import type { GeneratedContent, WriterSentenceProvenance } from "./generation";

export interface ProvenanceValidationResult {
  consistent: boolean;
  factConsistencyScore: number;
  issues: string[];
  sentenceVerdicts: ProvenanceSentenceVerdict[];
}

export interface ProvenanceSentenceVerdict extends WriterSentenceProvenance {
  supported: boolean;
  issue: string | null;
}

const LEGACY_SELF_CHECK_JSON_SCHEMA = {
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

const legacySelfCheckResponseSchema = z.object({
  verdicts: z.array(
    z.object({
      sentence_id: z.string(),
      supported: z.boolean(),
      supporting_fact_ids: z.array(z.string()),
      issue: z.string().nullable(),
    }),
  ),
});

export interface SelfCheckResult extends ProvenanceValidationResult {
  isFallback: boolean;
}

const DATE_TERMS: Record<string, string> = {
  hétfő: "monday",
  kedd: "tuesday",
  szerda: "wednesday",
  csütörtök: "thursday",
  péntek: "friday",
  szombat: "saturday",
  vasárnap: "sunday",
  január: "january",
  február: "february",
  március: "march",
  április: "april",
  május: "may",
  június: "june",
  július: "july",
  augusztus: "august",
  szeptember: "september",
  október: "october",
  november: "november",
  december: "december",
};

const CURRENCY_TERMS = [
  ["£", "gbp", "pound", "font"],
  ["€", "eur", "euro", "euró"],
  ["$", "usd", "dollar", "dollár"],
] as const;

const NON_NAME_CAPITALIZED = new Set([
  "a",
  "az",
  "egy",
  "ez",
  "így",
  "míg",
  "közben",
  "emellett",
  "ugyanakkor",
]);

const HUNGARIAN_NAME_SUFFIXES = [
  "nál",
  "nél",
  "ban",
  "ben",
  "hoz",
  "hez",
  "höz",
  "nak",
  "nek",
  "val",
  "vel",
  "ról",
  "ről",
  "tól",
  "től",
  "ért",
  "on",
  "en",
  "ön",
  "t",
];

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("hu-HU")
    .replace(/[’‘]/gu, "'")
    .replace(/[–—]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

function factText(fact: WriterFact): string {
  return [
    fact.claimEn,
    fact.evidenceOriginal,
    fact.subject,
    fact.normalizedValue,
    fact.eventTimeIso,
    fact.sourcePublishedAt,
    fact.quoteOriginal,
    fact.quoteSpeaker,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function normalizeTimes(value: string): string {
  return normalize(value).replace(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gu,
    (_match, rawHour: string, rawMinute: string | undefined, meridiem: string) => {
      let hour = Number(rawHour) % 12;
      if (meridiem === "pm") hour += 12;
      return `${String(hour).padStart(2, "0")}:${rawMinute ?? "00"}`;
    },
  );
}

function numericAnchors(value: string): string[] {
  const normalized = normalizeTimes(value);
  const compounds = normalized.match(/\b\d+(?:[.,]\d+)?\s*[-:]\s*\d+(?:[.,]\d+)?\b/gu) ?? [];
  const singles = normalized.match(/\b\d+(?:[.,]\d+)?\b/gu) ?? [];
  return [...new Set([...compounds, ...singles].map((anchor) => anchor.replace(/\s+/gu, "")))];
}

function quoteAnchors(value: string): string[] {
  return [...value.matchAll(/["„“]([^"”]+)["”]/gu)].map((match) => normalize(match[1] ?? ""));
}

function unsupportedNameTokens(sentence: string, citedText: string): string[] {
  const cited = normalize(citedText);
  return [...sentence.matchAll(/\p{Lu}[\p{L}'’-]{2,}/gu)]
    .filter((match) => (match.index ?? 0) > 0)
    .map((match) => normalize(match[0]))
    .filter(
      (token) =>
        !NON_NAME_CAPITALIZED.has(token) &&
        !cited.includes(token) &&
        !HUNGARIAN_NAME_SUFFIXES.some(
          (suffix) => token.endsWith(suffix) && cited.includes(token.slice(0, -suffix.length)),
        ),
    );
}

function expectedId(sentence: WriterSentenceProvenance, index: number): string {
  if (sentence.section === "title") return "T1";
  return `${sentence.section === "lead" ? "L" : "B"}${index + 1}`;
}

/** No-LLM, fail-closed validation of the provenance returned in the Writer response. */
export function validateGeneratedProvenance(
  input: Pick<GeneratedContent, "sentenceProvenance"> & { facts: WriterFact[] },
): ProvenanceValidationResult {
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const sectionIndexes = { title: 0, lead: 0, body: 0 };
  const seenIds = new Set<string>();

  const sentenceVerdicts = input.sentenceProvenance.map<ProvenanceSentenceVerdict>((sentence) => {
    const index = sectionIndexes[sentence.section]++;
    const issues: string[] = [];
    if (sentence.sentenceId !== expectedId(sentence, index) || seenIds.has(sentence.sentenceId)) {
      issues.push("invalid_sentence_id");
    }
    seenIds.add(sentence.sentenceId);

    const citedFacts = sentence.supportingFactIds
      .map((id) => factsById.get(id))
      .filter((fact): fact is WriterFact => Boolean(fact));
    if (sentence.supportingFactIds.length === 0) issues.push("missing_fact_provenance");
    if (citedFacts.length !== sentence.supportingFactIds.length) issues.push("unknown_fact_id");
    if (citedFacts.some((fact) => fact.isContradicted)) issues.push("contradicted_fact_used");

    const citedText = citedFacts.map(factText).join(" ");
    const citedNormalized = normalizeTimes(citedText);
    if (
      numericAnchors(sentence.text).some((anchor) => !numericAnchors(citedText).includes(anchor))
    ) {
      issues.push("unsupported_number_or_time");
    }
    for (const [symbol, ...aliases] of CURRENCY_TERMS) {
      if (
        [symbol, ...aliases].some((term) => normalize(sentence.text).includes(term)) &&
        ![symbol, ...aliases].some((term) => citedNormalized.includes(term))
      ) {
        issues.push("unsupported_currency");
      }
    }
    for (const [hungarian, english] of Object.entries(DATE_TERMS)) {
      if (
        normalize(sentence.text).includes(hungarian) &&
        !citedNormalized.includes(hungarian) &&
        !citedNormalized.includes(english)
      ) {
        issues.push("unsupported_date");
      }
    }
    if (
      quoteAnchors(sentence.text).some(
        (quote) =>
          !citedFacts.some(
            (fact) =>
              fact.factType === "quote" &&
              [fact.quoteOriginal, fact.evidenceOriginal]
                .filter((value): value is string => Boolean(value))
                .some((value) => normalize(value).includes(quote)),
          ),
      )
    ) {
      issues.push("unsupported_direct_quote");
    }
    if (unsupportedNameTokens(sentence.text, citedText).length > 0) {
      issues.push("unsupported_explicit_name");
    }

    const uniqueIssues = [...new Set(issues)];
    return {
      ...sentence,
      supported: uniqueIssues.length === 0,
      issue: uniqueIssues.length > 0 ? uniqueIssues.join(",") : null,
    };
  });

  const supportedCount = sentenceVerdicts.filter((sentence) => sentence.supported).length;
  const factConsistencyScore =
    sentenceVerdicts.length > 0 ? supportedCount / sentenceVerdicts.length : 0;
  const issues = sentenceVerdicts
    .filter((sentence) => !sentence.supported)
    .map(
      (sentence) =>
        `${sentence.sentenceId}: ${sentence.issue} [supporting_fact_ids: ${sentence.supportingFactIds.join(",")}]`,
    );
  return {
    consistent: sentenceVerdicts.length > 0 && supportedCount === sentenceVerdicts.length,
    factConsistencyScore,
    issues,
    sentenceVerdicts,
  };
}

/** Legacy editorial A/B diagnostic only; the publication path does not call this LLM check. */
export async function selfCheckContent(
  llm: LlmClient,
  input: { facts: WriterFact[]; titleHu: string; leadHu: string; bodyHu: string },
): Promise<SelfCheckResult> {
  const sentences = [input.titleHu, input.leadHu, input.bodyHu]
    .flatMap((text) => text.split(/(?<=[.!?])\s+|\n+/u))
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence, index) => ({ id: `S${index + 1}`, sentence }));
  const facts = input.facts.map((fact, index) => ({ ...fact, id: fact.id ?? `F${index + 1}` }));
  const result = await llm.completeJson({
    model: MODEL_TIERS.selfCheck,
    system:
      "Tényellenőr vagy. Minden mondatra pontosan egy verdictet adj, kizárólag létező Fact ID-k alapján.",
    messages: [{ role: "user", content: JSON.stringify({ facts, sentences }) }],
    maxTokens: 512,
    jsonSchema: LEGACY_SELF_CHECK_JSON_SCHEMA,
  });
  const parsed = legacySelfCheckResponseSchema.parse(result.data);
  const factsById = new Set(facts.map((fact) => fact.id));
  const verdictsById = new Map(parsed.verdicts.map((verdict) => [verdict.sentence_id, verdict]));
  const sentenceVerdicts = sentences.map<ProvenanceSentenceVerdict>((sentence) => {
    const verdict = verdictsById.get(sentence.id);
    const valid =
      verdict !== undefined &&
      verdict.supporting_fact_ids.every((id) => factsById.has(id)) &&
      (verdict.supported
        ? verdict.supporting_fact_ids.length > 0 && verdict.issue === null
        : Boolean(verdict.issue));
    return {
      sentenceId: sentence.id,
      section: "body",
      text: sentence.sentence,
      supportingFactIds: valid ? verdict.supporting_fact_ids : [],
      supported: valid ? verdict.supported : false,
      issue: valid ? verdict.issue : "missing_or_invalid_sentence_verdict",
    };
  });
  const supportedCount = sentenceVerdicts.filter((sentence) => sentence.supported).length;
  return {
    consistent: sentenceVerdicts.length > 0 && supportedCount === sentenceVerdicts.length,
    factConsistencyScore:
      sentenceVerdicts.length > 0 ? supportedCount / sentenceVerdicts.length : 0,
    issues: sentenceVerdicts
      .filter((sentence) => !sentence.supported)
      .map(
        (sentence) =>
          `${sentence.sentenceId}: ${sentence.issue} [supporting_fact_ids: ${sentence.supportingFactIds.join(",")}]`,
      ),
    sentenceVerdicts,
    isFallback: result.isFallback ?? false,
  };
}
