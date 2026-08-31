interface ScoreFactLike {
  id: string;
  factType: string;
  payload: unknown;
}

function payloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object" || !(key in payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A canonical English claim, with legacy detail_hu read-only compatibility. */
export function detailOf(payload: unknown): string | null {
  return (
    (payloadString(payload, "claim_en") ?? payloadString(payload, "detail_hu"))?.toLowerCase() ??
    null
  );
}

/** A `payload.detail_hu` nyers (csak trimmelt, kis/nagybetű megtartva) szövege — megjelenítéshez, nem csoportosításhoz. */
export function rawDetailOf(payload: unknown): string | null {
  return payloadString(payload, "claim_en") ?? payloadString(payload, "detail_hu");
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
  const byClaimSlot = new Map<string, ScoreFactLike[]>();
  for (const fact of comparableFacts) {
    const subject = payloadString(fact.payload, "subject")?.toLowerCase();
    const predicate = payloadString(fact.payload, "predicate")?.toLowerCase();
    if (!subject || !predicate) continue;
    const slot = `${fact.factType}:${subject}:${predicate}`;
    const group = byClaimSlot.get(slot) ?? [];
    group.push(fact);
    byClaimSlot.set(slot, group);
  }

  const contradictedIds: string[] = [];
  for (const group of byClaimSlot.values()) {
    const distinctValues = new Set(
      group
        .map(
          (fact) =>
            payloadString(fact.payload, "normalized_value")?.toLowerCase() ??
            payloadString(fact.payload, "event_time_iso")?.toLowerCase() ??
            detailOf(fact.payload),
        )
        .filter((detail): detail is string => detail !== null),
    );
    if (distinctValues.size > 1) {
      contradictedIds.push(...group.map((fact) => fact.id));
    }
  }
  return contradictedIds;
}
