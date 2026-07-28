interface ScoreFactLike {
  id: string;
  factType: string;
  payload: unknown;
}

/** A `payload.detail_hu` normalizált (trim+lowercase) szövege, vagy `null` ha nincs ilyen mező — a claim-merge modul is ezt használja csoportosításhoz. */
export function detailOf(payload: unknown): string | null {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "detail_hu" in payload &&
    typeof (payload as { detail_hu: unknown }).detail_hu === "string"
  ) {
    return (payload as { detail_hu: string }).detail_hu.trim().toLowerCase();
  }
  return null;
}

/**
 * Cross-source contradiction check (docs/architecture/02-agents.md §2.4):
 * "azonos fact_type-ú tények forrásonkénti összevetése — egyezés →
 * corroboration_count++; eltérés → is_contradicted=true". MVP scope limits
 * this to `score` facts (the type where a plain text diff is meaningful
 * without semantic understanding — "3-1" vs "2-1" is an unambiguous
 * disagreement, unlike free-text `other`/`quote` facts where a literal
 * string diff would false-positive constantly).
 */
export function findContradictedFactIds(facts: ScoreFactLike[]): string[] {
  const scoreFacts = facts.filter((fact) => fact.factType === "score");
  const distinctDetails = new Set(
    scoreFacts
      .map((fact) => detailOf(fact.payload))
      .filter((detail): detail is string => detail !== null),
  );
  if (distinctDetails.size <= 1) {
    return [];
  }
  return scoreFacts.map((fact) => fact.id);
}
