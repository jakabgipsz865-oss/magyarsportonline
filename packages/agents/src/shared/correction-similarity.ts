/**
 * "Hasonló korábbi javítások automatikus ajánlása" (2026-07-28-i "gyors
 * tanítási munkafolyamat" sprint) — SZÁNDÉKOSAN nem AI/LLM-alapú: tiszta,
 * determinisztikus szóhalmaz-hasonlóság (Jaccard-index) a jelenlegi magyar
 * mondat és a korábban elfogadott javítások "current_sentence_hu" mezője
 * között. A cél nem tökéletes szemantikai egyezés, hanem hogy a szerkesztő
 * gyorsan lássa: "ehhez hasonlót már javítottam korábban" — egy kattintással
 * alkalmazható kiindulópontot adva, amit ő maga ellenőriz/módosít.
 */

import type { EditorialCorrection } from "./editorial-corrections";

const STOPWORDS = new Set([
  "a",
  "az",
  "és",
  "is",
  "de",
  "hogy",
  "egy",
  "nem",
  "meg",
  "el",
  "ki",
  "be",
  "le",
  "fel",
  "vagy",
  "mint",
  "már",
  "még",
  "csak",
]);

/** Kisbetűsít, írásjeleket eltávolít, szavakra bont, kiszűri a magyar kötőszó-jellegű "stopword"-öket és az 1 karakteres töredékeket. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:„”"()\-–—]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

/** Jaccard-index: metszet/unió, 0 (semmi közös) és 1 (azonos szóhalmaz) között. */
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) {
      intersection += 1;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface SimilarCorrectionMatch {
  correction: EditorialCorrection;
  score: number;
}

/**
 * A megadott magyar mondathoz legjobban hasonlító korábbi javításokat adja
 * vissza (a javítás "current_sentence_hu" mezője alapján), pontszám szerint
 * csökkenő sorrendben. `minScore` alatt semmit nem ad vissza — a legtöbb
 * mondatnak nincs releváns előzménye, és egy irreleváns "hasonló" javaslat
 * rontana a gyorsaságon, nem javítana rajta.
 */
export function findSimilarCorrections(
  sentenceHu: string,
  corrections: EditorialCorrection[],
  limit = 3,
  minScore = 0.3,
): SimilarCorrectionMatch[] {
  const targetTokens = tokenize(sentenceHu);
  if (targetTokens.length === 0) {
    return [];
  }
  const scored = corrections
    .map((correction) => ({
      correction,
      score: jaccardSimilarity(targetTokens, tokenize(correction.currentSentenceHu)),
    }))
    .filter((match) => match.score >= minScore)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
