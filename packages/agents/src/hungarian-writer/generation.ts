import type { EditorialKnowledgeRecord } from "@magyarsportonline/db";
import { MODEL_TIERS, type LlmClient } from "@magyarsportonline/llm";
import { z } from "zod";
import type { WriterFact } from "./facts";
import type { QualityIssue } from "./quality-gate";

const GENERATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "object",
      properties: {
        text: { type: "string" },
        supporting_fact_ids: { type: "array", items: { type: "string" }, minItems: 1 },
      },
      required: ["text", "supporting_fact_ids"],
      additionalProperties: false,
    },
    lead_sentences: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^L[1-9][0-9]*$" },
          text: { type: "string" },
          supporting_fact_ids: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        required: ["id", "text", "supporting_fact_ids"],
        additionalProperties: false,
      },
    },
    body_paragraphs: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          sentences: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                id: { type: "string", pattern: "^B[1-9][0-9]*$" },
                text: { type: "string" },
                supporting_fact_ids: { type: "array", items: { type: "string" }, minItems: 1 },
              },
              required: ["id", "text", "supporting_fact_ids"],
              additionalProperties: false,
            },
          },
        },
        required: ["sentences"],
        additionalProperties: false,
      },
    },
    change_summary_hu: { type: ["string", "null"] },
  },
  required: ["title", "lead_sentences", "body_paragraphs", "change_summary_hu"],
  additionalProperties: false,
} as const;

const sentenceSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  supporting_fact_ids: z.array(z.string()).min(1),
});

const generationResponseSchema = z.object({
  title: z.object({
    text: z.string().min(1),
    supporting_fact_ids: z.array(z.string()).min(1),
  }),
  lead_sentences: z.array(sentenceSchema).min(1),
  body_paragraphs: z.array(z.object({ sentences: z.array(sentenceSchema).min(1) })).min(1),
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
  /** Az adott Storyhoz determinisztikusan kiválasztott, aktív V2 tudás. */
  knowledge?: EditorialKnowledgeRecord[];
}

export interface GeneratedContent {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
  changeSummaryHu: string | null;
  sentenceProvenance: WriterSentenceProvenance[];
  /** true, ha ez a tartalom egy LLM-hiba miatti No-LLM fallback-válaszból származik, nem valódi AI-generálásból — lásd LlmUsage.isFallback (client.ts). */
  isFallback: boolean;
}

export interface WriterSentenceProvenance {
  sentenceId: string;
  section: "title" | "lead" | "body";
  text: string;
  supportingFactIds: string[];
}

const GROUNDED_LENGTH_RULE = `A cikk hossza kizárólag a rendelkezésre álló grounded Facts és evidence mennyiségéhez igazodjon. Nincs minimális karakter-, mondat- vagy bekezdésszám. A teljesség soha nem írhatja felül a faktuális groundingot. Kevés tényből rövid cikket írj; tilos padding, háttér-információ, szerepkör, időbeli kontextus vagy következtetés hozzáadása, ha azt a Facts/evidence nem támasztja alá. Időszakot (például „nyáron” vagy „ebben a szezonban”) és személy tisztségét (például „vezetőedző” vagy „sportigazgató”) csak explicit Fact/evidence alapján írj le. Semmilyen „köztudott” háttér-információt ne használj.`;

const SYSTEM_PROMPT = `Magyar sportújságíró vagy egy mai online sportportálnál. Kizárólag a felhasználói üzenetben JSON-ként megadott, angol "claimEn" és szó szerinti "evidenceOriginal" mezőkkel alátámasztott facts tömbre támaszkodva írj eredeti, magyar nyelvű hírt. SOSEM tartalmazhat olyan állítást, ami nincs a tények között. Ha egy infó hiányzik, ne találd ki.

Szabályok:
- "title.text": KÖTELEZŐEN teljes egészében MAGYAR nyelvű, 6-14 szavas, igés, cselekvő, rövid és tényszerű cím, amilyet egy valódi magyar sportportál (pl. nso.hu, m4sport.hu) főoldalán látnál. Ha van releváns szám vagy eredmény a tényekben, emeld előtérbe. Tulajdonneveken kívül ne maradjon angol szöveg. Ne fordíts szó szerint angol mondatszerkezetet — fogalmazz anyanyelvi szerkesztőként.
- "lead_sentences": 1-2 mondatos, lehetőleg 40 szó alatti magyar bevezető. Az ID-k sorrendben L1, L2 legyenek.
- "body_paragraphs": a törzsszöveg bekezdései; minden bekezdés "sentences" tömböt tartalmaz. A mondat-ID-k az egész törzsben sorrendben B1, B2... legyenek. ${GROUNDED_LENGTH_RULE} Minden mondat ÚJ információt vigyen tovább — SOSEM írhatod le ugyanazt a tényt/mondatot kétszer, még átfogalmazva sem.
- A title, valamint minden lead- és body-mondat "supporting_fact_ids" mezőjében sorold fel az összes közvetlenül alátámasztó, bemenetben szereplő Fact ID-t. Egyetlen mondat provenance mezője sem lehet üres.
- Természetes, élő, mai magyar sportújságírói stílust használj — ne fordíts szó szerint, ne másold be a "claimEn" vagy "evidenceOriginal" szövegét; fogalmazz újra, kerüld az ismétlést és a gépies, monoton mondatszerkezetet.
- A hangnem legyen magabiztos és tényközlő, de ne száraz. A dráma a tényekből fakadjon, ne szenzációhajhász jelzőkből.
- Ügyelj a magyar nyelvtanra: helyes névelőhasználat (a/az), ékezetek, ragozás és mondatszerkezet.
- Angol "quote" Fact tartalmát magyarul csak idézőjel nélküli parafrázisként add vissza. Magyar fordítást ne tegyél közvetlen idézőjelbe. Közvetlen idézőjel kizárólag a "quoteOriginal"/"evidenceOriginal" karakterpontos eredeti idézetéhez használható, "quoteSpeaker" szerinti forrás-hivatkozással.
- Ha a rendszerüzenet végén "SZERKESZTŐI TUDÁS V2" blokk szerepel, kizárólag az ott megadott releváns, aktív és ellenőrzött magyar alakokat/szabályokat használd; a "KERÜLD" alakokat ne írd le.
- Ha a felhasználói üzenet "previousVersion" mezője nem null, a "change_summary_hu" mezőben egy rövid, magyar nyelvű összefoglalót adj arról, mi változott az előző verzióhoz képest. Ha "previousVersion" null (ez az első verzió), a "change_summary_hu" legyen null.`;

const QUALITY_FIX_SYSTEM_PROMPT = `Magyar sportújságíró vagy. Az előző tervezeted NEM felelt meg a minőségi elvárásoknak — a felhasználói üzenet "previousAttempt" mezője mutatja a hibás tervezetet, "issues" mezője pedig a talált problémákat (pl. "title: looks_english" = a cím angolul maradt; "lead: empty" = a lead üres; "body: matches_source_verbatim" = a törzs szó szerint megegyezik egy ténnyel; "body: repeated_paragraph" = két bekezdés ugyanazt mondja el, csak átfogalmazva; "lead: duplicates_body" = a lead szó szerint megismétlődik egy bekezdésben).

Írd újra TELJESEN a "facts" tömbre támaszkodva:
- a cím, a lead és a törzs MINDEGYIKE teljes egészében MAGYAR nyelvű legyen (tulajdonnevek kivételével), mai, természetes sportújságírói nyelven — ne tükörfordítás;
- egyik mező se maradjon üres;
- ${GROUNDED_LENGTH_RULE}
- egyik mező se legyen szó szerint azonos egy "facts" bejegyzéssel — fogalmazz újra, természetes magyar sportújságírói stílusban;
- HA a hiba "repeated_paragraph" vagy "duplicates_body" volt: a törzs bekezdései egymástól és a leadtől is EGYÉRTELMŰEN különböző mondatokat tartalmazzanak — minden bekezdés vigyen tovább valami újat, semmit ne írj le kétszer, még átfogalmazva sem;
- ügyelj a helyes névelőkre, ékezetekre és mondatszerkezetre;
- kizárólag a "facts" tömbben szereplő tényekre támaszkodj, ne találj ki semmit.`;

const FACT_REPAIR_SYSTEM_PROMPT = `Magyar sportújságíró vagy. Az előző tervezet tényellenőrzése hibát talált. Írd újra a teljes címet, leadet és törzset kizárólag a "facts" tömb alapján.

- A "selfCheckIssues" minden jelzett hibáját javítsd: a nem igazolt állítást töröld vagy igazítsd a Facts tartalmához.
- Semmilyen új tényt, nevet, számot, következtetést vagy körülményt ne találj ki.
- A "previousAttempt" csak a hibák azonosítására szolgál; a Facts az egyetlen hiteles tartalmi forrás.
- ${GROUNDED_LENGTH_RULE} Használd fel az egymással összeegyeztethető Facts nagy részét, ismétlés és új tény kitalálása nélkül.
- Maradjon természetes, mai magyar sportújságírói szöveg, és tartsd be a Szerkesztői Tudás V2 releváns szabályait.`;

/** A determinisztikusan kiválasztott V2 rekordok korlátos promptblokkja. */
export function formatEditorialKnowledgeBlock(records: EditorialKnowledgeRecord[]): string {
  const lines: string[] = [];
  for (const record of records.slice(0, 20)) {
    const guidance = [
      record.source_phrase ? `EN: "${record.source_phrase}"` : null,
      record.canonical_hu ? `HASZNÁLD: "${record.canonical_hu}"` : null,
      record.alternative_hu.length > 0 ? `ALTERNATÍVA: ${record.alternative_hu.join("; ")}` : null,
      record.avoid_hu.length > 0 ? `KERÜLD: ${record.avoid_hu.join("; ")}` : null,
      record.instruction_hu ? `SZABÁLY: ${record.instruction_hu}` : null,
      record.positive_examples[0]
        ? `PÉLDA: "${record.positive_examples[0].source_text}" → "${record.positive_examples[0].output_hu}"`
        : null,
    ].filter(Boolean);
    const candidate = `- [${record.stable_key}] ${guidance.join(" | ")}`;
    const next = `\n\nSZERKESZTŐI TUDÁS V2:\n${[...lines, candidate].join("\n")}`;
    if (next.length > 6_000) break;
    lines.push(candidate);
  }
  return lines.length > 0 ? `\n\nSZERKESZTŐI TUDÁS V2:\n${lines.join("\n")}` : "";
}

async function runGenerationCall(
  llm: LlmClient,
  system: string,
  userContent: unknown,
  knowledge: EditorialKnowledgeRecord[],
): Promise<GeneratedContent> {
  const result = await llm.completeJson({
    model: MODEL_TIERS.writing,
    system: system + formatEditorialKnowledgeBlock(knowledge),
    messages: [{ role: "user", content: JSON.stringify(userContent) }],
    // Production evidence showed MAX_TOKENS at 2048; 3072 is the smallest
    // bounded increase that leaves room for the complete structured article.
    maxTokens: 3072,
    thinkingLevel: "minimal",
    jsonSchema: GENERATION_JSON_SCHEMA,
  });

  const parsed = generationResponseSchema.parse(result.data);
  const bodySentences = parsed.body_paragraphs.flatMap((paragraph) => paragraph.sentences);
  const sentenceProvenance: WriterSentenceProvenance[] = [
    {
      sentenceId: "T1",
      section: "title",
      text: parsed.title.text.trim(),
      supportingFactIds: parsed.title.supporting_fact_ids,
    },
    ...parsed.lead_sentences.map((sentence) => ({
      sentenceId: sentence.id,
      section: "lead" as const,
      text: sentence.text.trim(),
      supportingFactIds: sentence.supporting_fact_ids,
    })),
    ...bodySentences.map((sentence) => ({
      sentenceId: sentence.id,
      section: "body" as const,
      text: sentence.text.trim(),
      supportingFactIds: sentence.supporting_fact_ids,
    })),
  ];
  return {
    titleHu: parsed.title.text.trim(),
    leadHu: parsed.lead_sentences.map((sentence) => sentence.text.trim()).join(" "),
    bodyHu: parsed.body_paragraphs
      .map((paragraph) => paragraph.sentences.map((sentence) => sentence.text.trim()).join(" "))
      .join("\n\n"),
    changeSummaryHu: parsed.change_summary_hu,
    sentenceProvenance,
    isFallback: result.isFallback ?? false,
  };
}

/** Hungarian Writer Agent's generation step (docs/architecture/02-agents.md §2.5) — Facts only, never raw source text. */
export async function generateStoryVersion(
  llm: LlmClient,
  input: GenerationInput,
): Promise<GeneratedContent> {
  return runGenerationCall(
    llm,
    SYSTEM_PROMPT,
    {
      facts: input.facts,
      previousVersion: input.previousVersion,
    },
    input.knowledge ?? [],
  );
}

export interface QualityFixInput extends GenerationInput {
  previousAttempt: { titleHu: string; leadHu: string; bodyHu: string };
  issues: QualityIssue[];
}

export interface FactRepairInput extends GenerationInput {
  previousAttempt: { titleHu: string; leadHu: string; bodyHu: string };
  selfCheckIssues: string[];
}

export async function regenerateWithFactRepair(
  llm: LlmClient,
  input: FactRepairInput,
): Promise<GeneratedContent> {
  return runGenerationCall(
    llm,
    FACT_REPAIR_SYSTEM_PROMPT,
    {
      facts: input.facts,
      previousVersion: input.previousVersion,
      previousAttempt: input.previousAttempt,
      selfCheckIssues: input.selfCheckIssues,
    },
    input.knowledge ?? [],
  );
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
  return runGenerationCall(
    llm,
    QUALITY_FIX_SYSTEM_PROMPT,
    {
      facts: input.facts,
      previousVersion: input.previousVersion,
      previousAttempt: input.previousAttempt,
      issues: input.issues.map((issue) => `${issue.field}: ${issue.kind}`),
    },
    input.knowledge ?? [],
  );
}
