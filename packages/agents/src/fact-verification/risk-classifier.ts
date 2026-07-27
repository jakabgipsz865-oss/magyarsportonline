import type { RiskLevel } from "@magyarsportonline/shared";

/**
 * Rule-based (non-LLM) risk classifier
 * (docs/architecture/02-agents.md §2.4: "szabályalapú kulcsszó/entitás-szűrő
 * réteg"). Deliberately keyword-based and Hungarian-language — this is the
 * cheap first pass; production would layer an LLM-based refinement on top
 * for borderline cases (documented as out of MVP scope, see
 * docs/adr/0007-mvp-llm-fallback-mode.md).
 *
 * Matching is diacritic-insensitive (NFD-normalized) so real-world source
 * text with inconsistent accent usage (typos, transliteration, different
 * publishers' house styles) doesn't silently slip past the keyword list.
 */
const COMBINING_DIACRITICAL_MARKS = /[̀-ͯ]/g;

function normalizeForMatching(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(COMBINING_DIACRITICAL_MARKS, "");
}

const HIGH_RISK_KEYWORDS = [
  "meghalt",
  "elhunyt",
  "haláleset",
  "életét vesztette",
  "dopping",
  "doppingvétség",
  "letartóztat",
  "vádat emel",
  "büntetőeljárás",
].map(normalizeForMatching);

const MEDIUM_RISK_KEYWORDS = [
  "sérülés",
  "megsérült",
  "megsérülés",
  "kizárás",
  "fegyelmi",
  "eltiltás",
].map(normalizeForMatching);

export function classifyRisk(text: string, promptInjectionSuspected: boolean): RiskLevel {
  if (promptInjectionSuspected) {
    return "high";
  }
  const normalized = normalizeForMatching(text);
  if (HIGH_RISK_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "high";
  }
  if (MEDIUM_RISK_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "medium";
  }
  return "low";
}
