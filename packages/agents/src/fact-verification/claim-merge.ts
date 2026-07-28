import { detailOf } from "./contradiction-check";

export interface FactWithSource {
  id: string;
  factType: string;
  payload: unknown;
  sourceId: string;
}

export interface ClaimMergeResult {
  /** factId → hány DISZTINKT forrás állította ugyanazt (azonos fact_type + azonos normalizált szöveg) — legalább 1. */
  corroboratingSourceCountByFactId: Map<string, number>;
  /** A legjobban megerősített állítás forrásszáma — a Hitelességi mutató "független megerősítések száma" bemenete. */
  maxCorroboratingSourceCount: number;
}

/**
 * Többforrásos állítás-összevonás v1 (2026-07-28-i "Hitelességi mutató"
 * sprint, sprint-prioritás #1). A meglévő `findContradictedFactIds`
 * (contradiction-check.ts) csak "score" típusra korlátozza magát, mert egy
 * szabad szöveg (pl. "quote"/"other") literál eltérése hamis pozitívot adna
 * ELLENTMONDÁSKÉNT. A MEGERŐSÍTÉS számlálása fordított kockázatú: ha két
 * forrás szövege NEM egyezik pontosan, legfeljebb alulszámoljuk a
 * megerősítést (biztonságos hiba), sosem jelzünk téves ellentmondást —
 * ezért ez a függvény MINDEN fact_type-ra fut, nem csak "score"-ra.
 *
 * Az `insertMany`-ből visszakapott Fact-ok `rawArticleId`-jét a hívó
 * (recompute-credibility.ts) map-eli `sourceId`-re a `story_sources` +
 * `raw_articles` + `sources` join alapján, mielőtt ide adja.
 */
export function mergeClaims(facts: FactWithSource[]): ClaimMergeResult {
  const sourceIdsByGroupKey = new Map<string, Set<string>>();
  const groupKeyByFactId = new Map<string, string>();

  for (const fact of facts) {
    const detail = detailOf(fact.payload);
    if (detail === null) {
      continue;
    }
    const groupKey = `${fact.factType}|${detail}`;
    groupKeyByFactId.set(fact.id, groupKey);
    const sourceIds = sourceIdsByGroupKey.get(groupKey) ?? new Set<string>();
    sourceIds.add(fact.sourceId);
    sourceIdsByGroupKey.set(groupKey, sourceIds);
  }

  const corroboratingSourceCountByFactId = new Map<string, number>();
  let maxCorroboratingSourceCount = 0;

  for (const fact of facts) {
    const groupKey = groupKeyByFactId.get(fact.id);
    const count = groupKey ? (sourceIdsByGroupKey.get(groupKey)?.size ?? 1) : 1;
    corroboratingSourceCountByFactId.set(fact.id, count);
    maxCorroboratingSourceCount = Math.max(maxCorroboratingSourceCount, count);
  }

  return { corroboratingSourceCountByFactId, maxCorroboratingSourceCount };
}
