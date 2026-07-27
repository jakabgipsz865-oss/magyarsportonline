import type { FactType } from "@magyarsportonline/shared";
import type { ExtractedFact } from "./llm-extractor.js";

/**
 * Fact types where a single canonical value is expected per Story (a
 * result has exactly one final score) — these are checked against existing
 * facts for corroboration/contradiction. "quote" and "other" can have many
 * independently true instances (different people say different things), so
 * they are always inserted as new, distinct facts rather than merged.
 */
const SINGLE_VALUE_FACT_TYPES: FactType[] = [
  "score",
  "event_time",
  "injury_status",
  "transfer_status",
];

export function isSingleValueFactType(factType: FactType): boolean {
  return SINGLE_VALUE_FACT_TYPES.includes(factType);
}

export function factPayloadsAgree(
  factType: FactType,
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  if (factType === "score") {
    return a["home"] === b["home"] && a["away"] === b["away"];
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface ExistingFactRow {
  id: string;
  factType: FactType;
  payload: unknown;
}

export type FactMergeAction =
  | { kind: "insert" }
  | { kind: "corroborate"; existingFactId: string }
  | { kind: "contradict"; existingFactId: string };

/** Pure decision function — no DB access, so it's directly unit-testable. */
export function decideFactMergeAction(
  newFact: ExtractedFact,
  existingFacts: ExistingFactRow[],
): FactMergeAction {
  if (!isSingleValueFactType(newFact.factType)) {
    return { kind: "insert" };
  }

  const matchingExisting = existingFacts.filter((f) => f.factType === newFact.factType);
  if (matchingExisting.length === 0) {
    return { kind: "insert" };
  }

  const first = matchingExisting[0];
  if (!first) {
    return { kind: "insert" };
  }

  const agrees = factPayloadsAgree(
    newFact.factType,
    (first.payload ?? {}) as Record<string, unknown>,
    newFact.payload,
  );
  return agrees
    ? { kind: "corroborate", existingFactId: first.id }
    : { kind: "contradict", existingFactId: first.id };
}
