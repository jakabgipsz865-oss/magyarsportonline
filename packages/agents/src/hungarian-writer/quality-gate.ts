import type { WriterFact } from "./facts";

export type QualityIssueField = "title" | "lead" | "body";
export type QualityIssueKind =
  | "empty"
  | "looks_english"
  | "matches_source_verbatim"
  | "repeated_paragraph"
  | "duplicates_body";

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

const MIN_LENGTH_FOR_DUPLICATE_CHECK = 20;

function normalizeForDuplicateCheck(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * Catches both an exact repeat and the more common LLM failure mode of
 * restating the same paragraph with a sentence added or dropped — a plain
 * string-equality check would miss the latter, which is what the writer
 * model (Qwen3) was observed to actually produce in production.
 */
function areNearDuplicates(a: string, b: string): boolean {
  const normalizedA = normalizeForDuplicateCheck(a);
  const normalizedB = normalizeForDuplicateCheck(b);
  if (normalizedA.length < MIN_LENGTH_FOR_DUPLICATE_CHECK) return false;
  if (normalizedB.length < MIN_LENGTH_FOR_DUPLICATE_CHECK) return false;
  if (normalizedA === normalizedB) return true;

  const shorter = normalizedA.length <= normalizedB.length ? normalizedA : normalizedB;
  const longer = normalizedA.length <= normalizedB.length ? normalizedB : normalizedA;
  if (longer.includes(shorter)) return true;

  const tokensA = new Set(normalizedA.split(" ").filter((token) => token.length > 3));
  const tokensB = new Set(normalizedB.split(" ").filter((token) => token.length > 3));
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) shared += 1;
  }
  return shared / Math.min(tokensA.size, tokensB.size) >= 0.75;
}

/** Two paragraphs within the same body that are the model repeating itself, verbatim or near-verbatim. */
function hasRepeatedParagraph(bodyHu: string): boolean {
  const paragraphs = splitParagraphs(bodyHu);
  for (let i = 0; i < paragraphs.length; i += 1) {
    for (let j = i + 1; j < paragraphs.length; j += 1) {
      if (areNearDuplicates(paragraphs[i]!, paragraphs[j]!)) return true;
    }
  }
  return false;
}

/** The lead restated as its own body paragraph instead of the body elaborating on it — a distinct failure mode from a `matches_source_verbatim` Fact copy. */
function leadDuplicatesBodyParagraph(leadHu: string, bodyHu: string): boolean {
  return splitParagraphs(bodyHu).some((paragraph) => areNearDuplicates(leadHu, paragraph));
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
  if (hasRepeatedParagraph(input.bodyHu)) {
    issues.push({ field: "body", kind: "repeated_paragraph" });
  }
  if (leadDuplicatesBodyParagraph(input.leadHu, input.bodyHu)) {
    issues.push({ field: "lead", kind: "duplicates_body" });
  }
  return { passed: issues.length === 0, issues };
}
