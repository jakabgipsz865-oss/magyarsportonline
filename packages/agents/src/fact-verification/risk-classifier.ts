import type { RiskLevel } from "@magyarsportonline/shared";

/**
 * Rule-based sensitive-category keyword filter (docs/architecture/02-agents.md
 * §2.4: "sérülés súlyossága, haláleset, doppingvád, jogi ügy" among others).
 * LLM-based risk refinement for borderline cases is explicitly deferred
 * (docs/adr/0005-mvp-end-to-end-scope-cuts.md decision 5) — this is the
 * rule-based layer only.
 */
const SENSITIVE_KEYWORDS = [
  // injury
  "injury",
  "injured",
  "sérülés",
  "sérült",
  // death
  "dies",
  "died",
  "death",
  "meghalt",
  "elhunyt",
  // legal
  "lawsuit",
  "arrested",
  "court case",
  "bíróság",
  "letartóztat",
  // doping
  "doping",
  "banned substance",
  "doppingvét",
];

/**
 * Prompt injection suspicion heuristic (docs/architecture/02-agents.md §2.4):
 * scans source text for instruction-shaped patterns before it ever reaches
 * an LLM prompt. This does not replace the delimited-block defense in
 * extraction.ts — it is the explicit "gyanú-jelző" the risk classifier
 * needs regardless of whether the delimiting actually held.
 */
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+|the\s+)?(previous|above|prior)\s+instructions?/i,
  /disregard\s+(the\s+)?(above|previous|prior)/i,
  /system\s*prompt/i,
  /you\s+are\s+now\s+/i,
  /\bnew\s+instructions?\s*:/i,
  /\[\s*(system|assistant)\s*\]/i,
];

export interface RiskClassificationInput {
  text: string;
  sourceCount: number;
}

export interface RiskClassificationResult {
  riskLevel: RiskLevel;
  promptInjectionSuspected: boolean;
  sensitiveCategoryDetected: boolean;
}

export function classifyRisk(input: RiskClassificationInput): RiskClassificationResult {
  const normalized = input.text.toLowerCase();
  const promptInjectionSuspected = PROMPT_INJECTION_PATTERNS.some((pattern) =>
    pattern.test(input.text),
  );
  const sensitiveCategoryDetected = SENSITIVE_KEYWORDS.some((keyword) =>
    normalized.includes(keyword),
  );

  let riskLevel: RiskLevel = "low";
  if (promptInjectionSuspected) {
    // Overrides everything else (docs/architecture/02-agents.md §2.4:
    // "függetlenül minden más tényezőtől").
    riskLevel = "high";
  } else if (sensitiveCategoryDetected && input.sourceCount < 2) {
    // Folds the Publish Gate's hard rule ("sensitive category + single
    // source never auto-publishes") into risk_level=high here, instead of
    // modeling a separate `sensitive category` field on Story — the
    // existing Publish Gate rule (risk_level=low required for auto-publish)
    // already produces the same protective outcome.
    riskLevel = "high";
  } else if (sensitiveCategoryDetected) {
    riskLevel = "medium";
  }

  return { riskLevel, promptInjectionSuspected, sensitiveCategoryDetected };
}
