import { MODEL_TIERS, type LlmClient } from "@magyarsportonline/llm";
import { z } from "zod";
import {
  correctionsToForbiddenLiteralTranslations,
  correctionsToLexiconEntries,
  correctionsToRecommendedPhrasings,
  formatForbiddenTranslationsBlock,
  formatPromptExamplesBlock,
  formatRecommendedPhrasingsBlock,
  type EditorialCorrection,
} from "../shared/editorial-corrections";
import {
  FOOTBALL_LEXICON,
  findLexiconMatchesInHungarianText,
  findRelevantLexiconEntries,
  formatLexiconBlock,
} from "../shared/football-lexicon";
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
  /** Szerkesztő által elfogadott, korábbi javítások (legfrissebb elöl) — lásd editorial-corrections.ts. Alapértelmezés: üres lista, ha a hívó nem ad meg semmit. */
  learnedCorrections?: EditorialCorrection[];
}

export interface GeneratedContent {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
  changeSummaryHu: string | null;
  /** true, ha ez a tartalom egy LLM-hiba miatti No-LLM fallback-válaszból származik, nem valódi AI-generálásból — lásd LlmUsage.isFallback (client.ts). */
  isFallback: boolean;
}

const SYSTEM_PROMPT = `Magyar sportújságíró vagy egy mai online sportportálnál. Kizárólag a felhasználói üzenetben JSON-ként megadott "facts" tömbre támaszkodva írj eredeti, magyar nyelvű hírt — SOSEM fordítás, és SOSEM tartalmazhat olyan állítást, ami nincs a tények között. Ha egy infó hiányzik, ne találd ki.

Szabályok:
- "title_hu": KÖTELEZŐEN teljes egészében MAGYAR nyelvű, 6-14 szavas, igés, cselekvő, rövid és tényszerű cím, amilyet egy valódi magyar sportportál (pl. nso.hu, m4sport.hu) főoldalán látnál. Ha van releváns szám vagy eredmény a tényekben, emeld előtérbe. Akkor is magyarul írj, ha a "detail_hu" hibásan angol; tulajdonneveken kívül ne maradjon angol szöveg. Ne fordíts szó szerint angol mondatszerkezetet (pl. "X gólos dráma alatt győzött") — fogalmazz anyanyelvi szerkesztőként.
- "lead_hu": 1-2 mondatos, lehetőleg 40 szó alatti magyar bevezető. Kontextusba helyezi a címet és összefoglal, de nem idézi szó szerint a törzs első mondatát.
- "body_hu": 5-8 bekezdéses, legalább 900 karakteres törzsszöveg, kizárólag a megadott tényekre építve, kötelezően magyarul. Egy bekezdés 2-4 rövid, egyenes szórendű mondat legyen. Minden bekezdés ÚJ információt vigyen tovább — SOSEM írhatod le ugyanazt a tényt/mondatot két bekezdésben, még átfogalmazva sem. Mielőtt leírsz egy bekezdést, ellenőrizd magadban, hogy annak tartalma nem szerepel-e már a lead-ben vagy egy korábbi bekezdésben; ha igen, hagyd ki vagy vidd tovább egy új részlettel. Ne nyújtsd mesterségesen a szöveget: ha nincs legalább öt bekezdéshez elegendő tény, csak a rendelkezésre álló tényeket használd.
- Természetes, élő, mai magyar sportújságírói stílust használj — ne fordíts szó szerint, ne másold be a "facts" szövegét változtatás nélkül; fogalmazz újra, kerüld az ismétlést és a gépies, monoton mondatszerkezetet.
- A hangnem legyen magabiztos és tényközlő, de ne száraz. A dráma a tényekből fakadjon, ne szenzációhajhász jelzőkből.
- Ügyelj a magyar nyelvtanra: helyes névelőhasználat (a/az), ékezetek, ragozás és mondatszerkezet.
- Szó szerinti idézetet KIZÁRÓLAG akkor használj, ha egy tény "factType" mezője "quote", és akkor is csak a megadott "quoteOriginal"/"quoteSpeaker" alapján, forrás-hivatkozással.
- Ha a rendszerüzenet végén egy "FUTBALLNYELVI SZÓTÁR" blokk szerepel, az a tényekben vagy idézetekben felismert angol futballkifejezések, szleng és hibás magyar tükörfordítások természetes magyar megfelelőit adja meg — ezeket használd, NE a megadott tükörfordítást.
- Ha a rendszerüzenet végén "TILTOTT TÜKÖRFORDÍTÁSOK", "AJÁNLOTT MAGYAR SPORTÚJSÁGÍRÓI MEGFOGALMAZÁSOK" vagy "PROMPT PÉLDATÁR" blokk szerepel, azok korábbi, emberi szerkesztő által ténylegesen elfogadott javítások — a tiltott alakot SOSEM használhatod, a többi mintát pedig kövesd; ezek nálad megbízhatóbb forrásból származnak, mint egy általános stílusszabály.
- Ha a felhasználói üzenet "previousVersion" mezője nem null, a "change_summary_hu" mezőben egy rövid, magyar nyelvű összefoglalót adj arról, mi változott az előző verzióhoz képest. Ha "previousVersion" null (ez az első verzió), a "change_summary_hu" legyen null.`;

const QUALITY_FIX_SYSTEM_PROMPT = `Magyar sportújságíró vagy. Az előző tervezeted NEM felelt meg a minőségi elvárásoknak — a felhasználói üzenet "previousAttempt" mezője mutatja a hibás tervezetet, "issues" mezője pedig a talált problémákat (pl. "title: looks_english" = a cím angolul maradt; "lead: empty" = a lead üres; "body: matches_source_verbatim" = a törzs szó szerint megegyezik egy ténnyel; "body: repeated_paragraph" = két bekezdés ugyanazt mondja el, csak átfogalmazva; "lead: duplicates_body" = a lead szó szerint megismétlődik egy bekezdésben).

Írd újra TELJESEN a "facts" tömbre támaszkodva:
- a cím, a lead és a törzs MINDEGYIKE teljes egészében MAGYAR nyelvű legyen (tulajdonnevek kivételével), mai, természetes sportújságírói nyelven — ne tükörfordítás;
- egyik mező se maradjon üres;
- a lead legyen legalább 80 karakteres, a törzs legalább 800 karakteres és több bekezdésből álljon;
- egyik mező se legyen szó szerint azonos egy "facts" bejegyzéssel — fogalmazz újra, természetes magyar sportújságírói stílusban;
- HA a hiba "repeated_paragraph" vagy "duplicates_body" volt: a törzs bekezdései egymástól és a leadtől is EGYÉRTELMŰEN különböző mondatokat tartalmazzanak — minden bekezdés vigyen tovább valami újat, semmit ne írj le kétszer, még átfogalmazva sem;
- ügyelj a helyes névelőkre, ékezetekre és mondatszerkezetre;
- kizárólag a "facts" tömbben szereplő tényekre támaszkodj, ne találj ki semmit.`;

/**
 * A Hungarian Writer Agent sosem látja a nyers angol forráscikket (lásd a
 * `generateStoryVersion` docstringjét) — a facts.detailHu mezőket a Fact
 * Verification Agent már lefordítja, de productionben ezekben is
 * előfordult angolul maradt szakkifejezés és hibás magyar tükörfordítás.
 * Ezért a lexikont a detailHu mezők és a szó szerint megőrzött idézetek
 * (`quoteOriginal`) együttese ellen illesztjük.
 */
function buildLexiconBlock(facts: WriterFact[], learnedCorrections: EditorialCorrection[]): string {
  const sourceText = facts
    .flatMap((fact) => [fact.detailHu, fact.quoteOriginal])
    .filter((text): text is string => Boolean(text))
    .join("\n");
  if (!sourceText) {
    return "";
  }
  const combinedLexicon = [...FOOTBALL_LEXICON, ...correctionsToLexiconEntries(learnedCorrections)];
  const entries = [
    ...findRelevantLexiconEntries(sourceText, 12, combinedLexicon),
    ...findLexiconMatchesInHungarianText(sourceText, combinedLexicon),
  ]
    .filter(
      (entry, index, all) => all.findIndex((candidate) => candidate.en === entry.en) === index,
    )
    .slice(0, 12);
  const block = formatLexiconBlock(entries);
  return block ? `\n\n${block}` : "";
}

/** A statikus lexikonon túl a szerkesztő eddig elfogadott javításaiból is épít egy blokkot — lásd editorial-corrections.ts. */
function buildLearnedGuidanceBlock(learnedCorrections: EditorialCorrection[]): string {
  const forbiddenBlock = formatForbiddenTranslationsBlock(
    correctionsToForbiddenLiteralTranslations(learnedCorrections).slice(0, 6),
  );
  const phrasingsBlock = formatRecommendedPhrasingsBlock(
    correctionsToRecommendedPhrasings(learnedCorrections),
    6,
  );
  const examplesBlock = formatPromptExamplesBlock(learnedCorrections, 6);
  const blocks = [forbiddenBlock, phrasingsBlock, examplesBlock].filter(Boolean);
  return blocks.length > 0 ? `\n\n${blocks.join("\n\n")}` : "";
}

async function runGenerationCall(
  llm: LlmClient,
  system: string,
  userContent: unknown,
  facts: WriterFact[],
  learnedCorrections: EditorialCorrection[],
): Promise<GeneratedContent> {
  const result = await llm.completeJson({
    model: MODEL_TIERS.writing,
    system:
      system +
      buildLexiconBlock(facts, learnedCorrections) +
      buildLearnedGuidanceBlock(learnedCorrections),
    messages: [{ role: "user", content: JSON.stringify(userContent) }],
    // A kimenet 900-1500 karakteres cikk és négy rövid JSON-mező. A
    // production Llama 3.3 nem használ rejtett Qwen reasoning tokent, ezért
    // a 4096-os korlát csak felesleges neuron-kitettség volt.
    maxTokens: 2048,
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
    input.facts,
    input.learnedCorrections ?? [],
  );
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
  return runGenerationCall(
    llm,
    QUALITY_FIX_SYSTEM_PROMPT,
    {
      facts: input.facts,
      previousVersion: input.previousVersion,
      previousAttempt: input.previousAttempt,
      issues: input.issues.map((issue) => `${issue.field}: ${issue.kind}`),
    },
    input.facts,
    input.learnedCorrections ?? [],
  );
}
