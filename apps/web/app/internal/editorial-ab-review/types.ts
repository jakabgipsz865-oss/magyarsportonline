/**
 * Megosztott alakok a szerver komponens (page.tsx, ami előszámolja a
 * lexikon-/hasonlósági javaslatokat) és a kliens komponens
 * (FastTrainingWorkbench.tsx, ami a gyors billentyűzet-vezérelt
 * tanítófolyamatot adja) között (2026-07-28-i "gyors tanítási
 * munkafolyamat" sprint).
 */

export interface LexiconSuggestion {
  kind: "lexicon";
  /** A felismert kerülendő tükörfordítás/szleng, ami a mondatban előfordul. */
  matchedAvoidHu: string;
  naturalHu: string;
  /** Az angol kifejezés — a "termEn" mező előtöltésére. */
  termEn: string;
  /** A lexikontétel példamondata — az "eredeti angol mondat" mező kiindulópontjaként. */
  exampleEn: string;
  /** A teljes mondat a kerülendő rész kicserélésével — egy kattintással kész, mentésre váró javaslat. */
  suggestedSentenceHu: string;
}

export interface SimilarSuggestion {
  kind: "similar";
  correctionId: string;
  score: number;
  category: string;
  currentSentenceHu: string;
  correctedSentenceHu: string;
  originalSentenceEn: string;
  termEn: string | null;
}

export type TrainingSuggestion = LexiconSuggestion | SimilarSuggestion;

export interface TrainingItem {
  itemId: string;
  storyId: string;
  field: "title" | "lead" | "body";
  sentenceHu: string;
  /** Változott-e a B (átírt) verzió az A (eredeti) mögöttes szövegéhez képest — csak tájékoztató jelzés. */
  changed: boolean;
  /** Az adott cikkhez kapcsolt eredeti angol forrás(ok) törzsszövege, egybefűzve — gyors másoláshoz. */
  originalSourcesText: string;
  suggestions: TrainingSuggestion[];
}
