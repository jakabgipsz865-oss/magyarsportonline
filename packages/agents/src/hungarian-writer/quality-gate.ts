import type { WriterFact } from "./facts";

export type QualityIssueField = "title" | "lead" | "body";
export type QualityIssueKind = "empty" | "looks_english" | "matches_source_verbatim";

export interface QualityIssue {
  field: QualityIssueField;
  kind: QualityIssueKind;
}

export interface QualityAssessmentInput {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
  facts: WriterFact[];
}

export interface QualityAssessment {
  passed: boolean;
  issues: QualityIssue[];
}

/** Below this length a language heuristic is unreliable either way (short proper-noun-heavy titles, test fixtures) — skip rather than false-positive. */
const MIN_LENGTH_FOR_LANGUAGE_CHECK = 20;

const HUNGARIAN_DIACRITICS = /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/;

/**
 * Whole-word Hungarian function words common enough that their total absence
 * from a longer text is itself a signal. Deliberately excludes words that
 * double as common English words ("a", "is", "de" as in "de facto") — those
 * would false-negate genuine English text sitting right next to a lone
 * article and defeat the whole check.
 */
const HUNGARIAN_FUNCTION_WORDS =
  /\b(az|és|hogy|egy|volt|lesz|meg|nem|mint|mert|amely|aki|ezt|azt|vagy|szerint|miatt|után|ellen|között|szeretné|valamint)\b/i;

function looksEnglish(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_LENGTH_FOR_LANGUAGE_CHECK) {
    return false;
  }
  if (HUNGARIAN_DIACRITICS.test(trimmed)) {
    return false;
  }
  if (HUNGARIAN_FUNCTION_WORDS.test(trimmed)) {
    return false;
  }
  return true;
}

/** Catches the case where the "translation" is just a fact's own detail_hu copied verbatim — including the fact-extraction No-LLM fallback's English passthrough (packages/llm no-llm-client.ts `extractionFallback`). */
function matchesFactVerbatim(text: string, facts: WriterFact[]): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized.length < 10) {
    return false;
  }
  return facts.some((fact) => {
    const factText = fact.detailHu.trim().toLowerCase();
    return factText.length > 0 && (factText === normalized || factText.includes(normalized));
  });
}

function assessField(field: QualityIssueField, text: string, facts: WriterFact[]): QualityIssue[] {
  if (text.trim().length === 0) {
    return [{ field, kind: "empty" }];
  }
  const issues: QualityIssue[] = [];
  if (looksEnglish(text)) {
    issues.push({ field, kind: "looks_english" });
  }
  if (matchesFactVerbatim(text, facts)) {
    issues.push({ field, kind: "matches_source_verbatim" });
  }
  return issues;
}

/**
 * Content Quality Gate (Content Quality & Reliability Hardening sprint):
 * catches the failure modes a schema-valid, non-fallback LLM response can
 * still have — empty field, a title/lead/body that never actually got
 * translated into Hungarian, or text that's just a Fact's own detail_hu
 * copied through (which itself may be English, if Fact Verification's
 * extraction step fell back to No-LLM — see no-llm-client.ts). Deliberately
 * heuristic and conservative (short strings are never flagged) rather than
 * a full language-detection dependency.
 */
export function assessContentQuality(input: QualityAssessmentInput): QualityAssessment {
  const issues: QualityIssue[] = [
    ...assessField("title", input.titleHu, input.facts),
    ...assessField("lead", input.leadHu, input.facts),
    ...assessField("body", input.bodyHu, input.facts),
  ];
  return { passed: issues.length === 0, issues };
}
