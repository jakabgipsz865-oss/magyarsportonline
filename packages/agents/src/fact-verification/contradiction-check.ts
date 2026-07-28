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

/** A `payload.detail_hu` nyers (csak trimmelt, kis/nagybetű megtartva) szövege — megjelenítéshez, nem csoportosításhoz. */
export function rawDetailOf(payload: unknown): string | null {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "detail_hu" in payload &&
    typeof (payload as { detail_hu: unknown }).detail_hu === "string"
  ) {
    const trimmed = (payload as { detail_hu: string }).detail_hu.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

/**
 * Fact-típusok, amikre a literál szöveg-egyezés vizsgálat megbízható (2026-07-28-i
 * "Hitelesség-magyarázat" bővítés — eredetileg csak "score"-ra korlátozva).
 * Ezek mind rövid, strukturált jellegű állítások (eredmény, sérülés-státusz,
 * átigazolási részlet, időpont), ahol egy eltérő szöveg tényleges eltérő
 * állítást jelent. A "quote"/"other" típusok TUDATOSAN kimaradnak — ott egy
 * szabad szöveg literál eltérése állandóan hamis pozitívot adna (két különböző
 * idézet nem feltétlenül "ellentmond" egymásnak, csak más dolgot mond).
 */
const COMPARABLE_FACT_TYPES = new Set(["score", "injury_status", "transfer_status", "event_time"]);

/**
 * Cross-source contradiction check (docs/architecture/02-agents.md §2.4):
 * "azonos fact_type-ú tények forrásonkénti összevetése — egyezés →
 * corroboration_count++; eltérés → is_contradicted=true". Minden
 * `COMPARABLE_FACT_TYPES`-beli típust KÜLÖN csoportban vizsgál (egy "score"
 * és egy "transfer_status" tény sosem "mond ellent" egymásnak, hiszen más
 * dologról szólnak) — egy adott típuson belül, ha 2+ eltérő normalizált
 * szöveg fordul elő, az összes idetartozó tényt ellentmondónak jelöli.
 */
export function findContradictedFactIds(facts: ScoreFactLike[]): string[] {
  const comparableFacts = facts.filter((fact) => COMPARABLE_FACT_TYPES.has(fact.factType));
  const byFactType = new Map<string, ScoreFactLike[]>();
  for (const fact of comparableFacts) {
    const group = byFactType.get(fact.factType) ?? [];
    group.push(fact);
    byFactType.set(fact.factType, group);
  }

  const contradictedIds: string[] = [];
  for (const group of byFactType.values()) {
    const distinctDetails = new Set(
      group
        .map((fact) => detailOf(fact.payload))
        .filter((detail): detail is string => detail !== null),
    );
    if (distinctDetails.size > 1) {
      contradictedIds.push(...group.map((fact) => fact.id));
    }
  }
  return contradictedIds;
}
