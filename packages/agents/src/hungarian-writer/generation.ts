import type { EditorialKnowledgeRecord } from "@magyarsportonline/db";
import { MODEL_TIERS, type LlmClient } from "@magyarsportonline/llm";
import { z } from "zod";
import type { WriterFact } from "./facts";
import { removeGeneratedRepetition, type QualityIssue } from "./quality-gate";

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
  /** Az adott Storyhoz determinisztikusan kiválasztott, aktív V2 tudás. */
  knowledge?: EditorialKnowledgeRecord[];
}

export interface GeneratedContent {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
  changeSummaryHu: string | null;
  /** true, ha ez a tartalom egy LLM-hiba miatti No-LLM fallback-válaszból származik, nem valódi AI-generálásból — lásd LlmUsage.isFallback (client.ts). */
  isFallback: boolean;
}

const SYSTEM_PROMPT = `Magyar sportújságíró vagy egy mai online sportportálnál. Kizárólag a felhasználói üzenetben JSON-ként megadott, angol "claimEn" és szó szerinti "evidenceOriginal" mezőkkel alátámasztott facts tömbre támaszkodva írj eredeti, magyar nyelvű hírt. SOSEM tartalmazhat olyan állítást, ami nincs a tények között. Ha egy infó hiányzik, ne találd ki.

Szabályok:
- "title_hu": KÖTELEZŐEN teljes egészében MAGYAR nyelvű, 6-14 szavas, igés, cselekvő, rövid és tényszerű cím, amilyet egy valódi magyar sportportál (pl. nso.hu, m4sport.hu) főoldalán látnál. Ha van releváns szám vagy eredmény a tényekben, emeld előtérbe. Tulajdonneveken kívül ne maradjon angol szöveg. Ne fordíts szó szerint angol mondatszerkezetet — fogalmazz anyanyelvi szerkesztőként.
- "lead_hu": 1-2 mondatos, lehetőleg 40 szó alatti magyar bevezető. Kontextusba helyezi a címet és összefoglal, de nem idézi szó szerint a törzs első mondatát.
- "body_hu": kizárólag a megadott tényekre épülő magyar törzsszöveg. Legalább 6 Fact esetén legyen legalább 800 karakter és 4–7 természetes bekezdés; kevesebb Fact esetén legyen rövidebb, tömör, 2–4 bekezdéses hír, mesterséges hosszabbítás nélkül. Egy bekezdés 2-4 rövid, egyenes szórendű mondat legyen. Minden bekezdés ÚJ információt vigyen tovább — SOSEM írhatod le ugyanazt a tényt/mondatot két bekezdésben, még átfogalmazva sem.
- Természetes, élő, mai magyar sportújságírói stílust használj — ne fordíts szó szerint, ne másold be a "claimEn" vagy "evidenceOriginal" szövegét; fogalmazz újra, kerüld az ismétlést és a gépies, monoton mondatszerkezetet.
- A hangnem legyen magabiztos és tényközlő, de ne száraz. A dráma a tényekből fakadjon, ne szenzációhajhász jelzőkből.
- Ügyelj a magyar nyelvtanra: helyes névelőhasználat (a/az), ékezetek, ragozás és mondatszerkezet.
- Szó szerinti idézetet KIZÁRÓLAG akkor használj, ha egy tény "factType" mezője "quote", és akkor is csak a megadott "quoteOriginal"/"quoteSpeaker" alapján, forrás-hivatkozással.
- Ha a rendszerüzenet végén "SZERKESZTŐI TUDÁS V2" blokk szerepel, kizárólag az ott megadott releváns, aktív és ellenőrzött magyar alakokat/szabályokat használd; a "KERÜLD" alakokat ne írd le.
- Ha a felhasználói üzenet "previousVersion" mezője nem null, a "change_summary_hu" mezőben egy rövid, magyar nyelvű összefoglalót adj arról, mi változott az előző verzióhoz képest. Ha "previousVersion" null (ez az első verzió), a "change_summary_hu" legyen null.`;

const QUALITY_FIX_SYSTEM_PROMPT = `Magyar sportújságíró vagy. Az előző tervezeted NEM felelt meg a minőségi elvárásoknak — a felhasználói üzenet "previousAttempt" mezője mutatja a hibás tervezetet, "issues" mezője pedig a talált problémákat (pl. "title: looks_english" = a cím angolul maradt; "lead: empty" = a lead üres; "body: matches_source_verbatim" = a törzs szó szerint megegyezik egy ténnyel; "body: repeated_paragraph" = két bekezdés ugyanazt mondja el, csak átfogalmazva; "lead: duplicates_body" = a lead szó szerint megismétlődik egy bekezdésben).

Írd újra TELJESEN a "facts" tömbre támaszkodva:
- a cím, a lead és a törzs MINDEGYIKE teljes egészében MAGYAR nyelvű legyen (tulajdonnevek kivételével), mai, természetes sportújságírói nyelven — ne tükörfordítás;
- egyik mező se maradjon üres;
- legalább 6 Fact esetén a lead legyen legalább 80 karakteres, a törzs legalább 800 karakteres és több bekezdésből álljon; kevesebb Fact esetén maradjon tömör, de teljes hír;
- egyik mező se legyen szó szerint azonos egy "facts" bejegyzéssel — fogalmazz újra, természetes magyar sportújságírói stílusban;
- HA a hiba "repeated_paragraph" vagy "duplicates_body" volt: a törzs bekezdései egymástól és a leadtől is EGYÉRTELMŰEN különböző mondatokat tartalmazzanak — minden bekezdés vigyen tovább valami újat, semmit ne írj le kétszer, még átfogalmazva sem;
- ügyelj a helyes névelőkre, ékezetekre és mondatszerkezetre;
- kizárólag a "facts" tömbben szereplő tényekre támaszkodj, ne találj ki semmit.`;

const FACT_REPAIR_SYSTEM_PROMPT = `Magyar sportújságíró vagy. Az előző tervezet tényellenőrzése hibát talált. Írd újra a teljes címet, leadet és törzset kizárólag a "facts" tömb alapján.

- A "selfCheckIssues" minden jelzett hibáját javítsd: a nem igazolt állítást töröld vagy igazítsd a Facts tartalmához.
- Semmilyen új tényt, nevet, számot, következtetést vagy körülményt ne találj ki.
- A "previousAttempt" csak a hibák azonosítására szolgál; a Facts az egyetlen hiteles tartalmi forrás.
- Ha legalább 6 Fact áll rendelkezésre, a lead legyen legalább 80 karakteres, a body legalább 800 karakteres és 4–7 természetes bekezdésből álljon. Használd fel az egymással összeegyeztethető Facts nagy részét, ismétlés és új tény kitalálása nélkül.
- Ha 6-nál kevesebb Fact áll rendelkezésre, készíts rövidebb, tömör, 2–4 bekezdéses hírt; tilos paddinggel, következtetéssel vagy új ténnyel mesterségesen hosszabbítani.
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
  const cleaned = removeGeneratedRepetition({
    leadHu: parsed.lead_hu,
    bodyHu: parsed.body_hu,
  });
  return {
    titleHu: parsed.title_hu,
    leadHu: cleaned.leadHu,
    bodyHu: cleaned.bodyHu,
    changeSummaryHu: parsed.change_summary_hu,
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
