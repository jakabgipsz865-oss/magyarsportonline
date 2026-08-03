/**
 * Emberi szerkesztői visszajelzésből ("tanítható szerkesztői felület",
 * 2026-07-28-i sprint, `/internal/editorial-ab-review`) épülő tanítóanyag —
 * minden elfogadott, mondatszintű javítás ide kerül, majd a kategóriája
 * dönti el, melyik levezetett listába (lexikon-bővítés, tiltott
 * tükörfordítások, ajánlott megfogalmazások, prompt-példatár) sorolódik.
 * A cél NEM egy másik AI-modellre váltás vagy modellek összehasonlítása —
 * ugyanaz a Cloudflare Workers AI modell kap egyre jobb, szerkesztő által
 * validált magyar sportnyelvi anyagot minden egyes híváskor.
 */

import type { LexiconEntry } from "./football-lexicon";

export type CorrectionCategory =
  | "slang"
  | "terminology"
  | "literal_translation"
  | "style"
  | "grammar"
  | "fact";

export const CORRECTION_CATEGORY_LABELS_HU: Record<CorrectionCategory, string> = {
  slang: "szleng",
  terminology: "terminológia",
  literal_translation: "tükörfordítás",
  style: "stílus",
  grammar: "nyelvhelyesség",
  fact: "tény",
};

/** Plain adatalak — a hívó (DB-hozzáféréssel rendelkező kód) tölti fel a repository sorokból. */
export interface EditorialCorrection {
  /** A repository sor elsődleges kulcsa — a mérési eseménynapló (correction-effectiveness.ts) ezzel köti össze a javítást a jövőbeli generálásokkal. */
  id: string;
  category: CorrectionCategory;
  termEn: string | null;
  originalSentenceEn: string;
  currentSentenceHu: string;
  correctedSentenceHu: string;
  note: string | null;
}

const SEARCH_STOPWORDS = new Set([
  "hogy",
  "mint",
  "majd",
  "volt",
  "egy",
  "the",
  "and",
  "with",
  "from",
  "this",
  "that",
]);

function searchableTokens(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase("hu-HU")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !SEARCH_STOPWORDS.has(token)),
  );
}

/**
 * A teljes hordozható memóriából az adott cikkhez leginkább kapcsolódó
 * javításokat választja ki. A bemeneti sorrend legfrissebb-elöl, ezért
 * azonos relevanciánál a frissebb szerkesztői döntés nyer.
 */
export function selectRelevantCorrections(
  corrections: EditorialCorrection[],
  context: string,
  limit = 20,
): EditorialCorrection[] {
  const normalizedContext = context.toLocaleLowerCase("hu-HU");
  const contextTokens = searchableTokens(context);
  return corrections
    .map((correction, index) => {
      const term = correction.termEn?.trim().toLocaleLowerCase("en-US") ?? "";
      const flaggedHu = correction.currentSentenceHu.trim().toLocaleLowerCase("hu-HU");
      const preferredHu = correction.correctedSentenceHu.trim().toLocaleLowerCase("hu-HU");
      const candidateTokens = searchableTokens(
        [
          correction.termEn ?? "",
          correction.originalSentenceEn,
          correction.currentSentenceHu,
          correction.correctedSentenceHu,
          correction.note ?? "",
        ].join(" "),
      );
      let score = 0;
      if (term && normalizedContext.includes(term)) score += 30;
      if (flaggedHu && normalizedContext.includes(flaggedHu)) score += 24;
      if (preferredHu && normalizedContext.includes(preferredHu)) score += 12;
      for (const token of candidateTokens) {
        if (contextTokens.has(token)) score += 2;
      }
      if (correction.category === "slang" || correction.category === "terminology") score += 1;
      return { correction, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ correction }) => correction);
}

/**
 * "slang"/"terminology" kategóriájú javításokból ugyanolyan alakú
 * `LexiconEntry`-ket épít, mint a kézzel írt football-lexicon.ts —
 * a hívó ezeket egyszerűen összefűzheti a statikus `FOOTBALL_LEXICON`-nal,
 * és a meglévő `findRelevantLexiconEntries`/`formatLexiconBlock` innentől
 * megkülönböztetés nélkül kezeli mindkettőt.
 */
export function correctionsToLexiconEntries(corrections: EditorialCorrection[]): LexiconEntry[] {
  return corrections
    .filter(
      (correction): boolean =>
        correction.category === "slang" || correction.category === "terminology",
    )
    .map((correction) => ({
      category: "learned" as const,
      en: correction.termEn?.trim() || correction.originalSentenceEn,
      meaningHu: correction.note?.trim() ?? "",
      naturalHu: correction.correctedSentenceHu,
      avoidLiteralHu: correction.currentSentenceHu,
      exampleEn: correction.originalSentenceEn,
      exampleHu: correction.correctedSentenceHu,
    }));
}

export interface ForbiddenLiteralTranslation {
  avoidHu: string;
  useInsteadHu: string;
  contextEn: string;
}

/** "literal_translation" kategóriájú javításokból — a tiltott tükörfordítások listája. */
export function correctionsToForbiddenLiteralTranslations(
  corrections: EditorialCorrection[],
): ForbiddenLiteralTranslation[] {
  return corrections
    .filter((correction) => correction.category === "literal_translation")
    .map((correction) => ({
      avoidHu: correction.currentSentenceHu,
      useInsteadHu: correction.correctedSentenceHu,
      contextEn: correction.originalSentenceEn,
    }));
}

/** Case-insensitive szövegrész-egyezés — csak azokat a tiltott fordulatokat adja vissza, amik a megadott (aktuális) magyar szövegben ténylegesen előfordulnak. */
export function findMatchingForbiddenTranslations(
  huText: string,
  forbidden: ForbiddenLiteralTranslation[],
  limit = 10,
): ForbiddenLiteralTranslation[] {
  const haystack = huText.toLowerCase();
  return forbidden
    .filter(
      (item) => item.avoidHu.trim().length > 0 && haystack.includes(item.avoidHu.toLowerCase()),
    )
    .slice(0, limit);
}

export function formatForbiddenTranslationsBlock(items: ForbiddenLiteralTranslation[]): string {
  if (items.length === 0) {
    return "";
  }
  const lines = items.map((item) => `- NE: "${item.avoidHu}" → HELYETTE: "${item.useInsteadHu}"`);
  return `TILTOTT TÜKÖRFORDÍTÁSOK — egy szerkesztő korábban kijavította ezt a pontos megfogalmazást, ne ismételd meg:\n${lines.join("\n")}`;
}

export interface RecommendedPhrasing {
  beforeHu: string;
  afterHu: string;
}

/** "style"/"grammar" kategóriájú javításokból — ajánlott magyar sportújságírói megfogalmazások. */
export function correctionsToRecommendedPhrasings(
  corrections: EditorialCorrection[],
): RecommendedPhrasing[] {
  return corrections
    .filter((correction) => correction.category === "style" || correction.category === "grammar")
    .map((correction) => ({
      beforeHu: correction.currentSentenceHu,
      afterHu: correction.correctedSentenceHu,
    }));
}

/** A lista már legfrissebb-elöl sorrendben érkezik a repository-tól — itt csak korlátozzuk. */
export function formatRecommendedPhrasingsBlock(items: RecommendedPhrasing[], limit = 10): string {
  const capped = items.slice(0, limit);
  if (capped.length === 0) {
    return "";
  }
  const lines = capped.map((item) => `- "${item.beforeHu}" helyett: "${item.afterHu}"`);
  return `AJÁNLOTT MAGYAR SPORTÚJSÁGÍRÓI MEGFOGALMAZÁSOK (korábbi szerkesztői javításokból):\n${lines.join("\n")}`;
}

/**
 * A teljes, vegyes kategóriájú "prompt példatár" — MINDEN elfogadott
 * javítás bekerül ide, kategóriától függetlenül, hogy a modell konkrét
 * rossz→jó párokból tanuljon, ne csak elvont szabályokból. Legfrissebb
 * elöl, korlátozva, hogy a prompt mérete/költsége kordában maradjon akkor
 * is, ha a lista sokáig nő.
 */
export function formatPromptExamplesBlock(corrections: EditorialCorrection[], limit = 10): string {
  const capped = corrections.slice(0, limit);
  if (capped.length === 0) {
    return "";
  }
  const lines = capped.map(
    (correction) =>
      `- [${CORRECTION_CATEGORY_LABELS_HU[correction.category]}] "${correction.currentSentenceHu}" → "${correction.correctedSentenceHu}"`,
  );
  return `PROMPT PÉLDATÁR — korábbi, szerkesztő által elfogadott javítások, kövesd ezek mintáját:\n${lines.join("\n")}`;
}
