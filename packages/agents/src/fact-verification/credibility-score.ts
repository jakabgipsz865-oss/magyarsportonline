import type { CredibilityBand } from "@magyarsportonline/shared";
import { credibilityBandForScore } from "@magyarsportonline/shared";

export interface CredibilityScoreInput {
  /** Van-e a Story mögött hivatalos forrás (liga/klub/szövetség, `sources.category` official/league/club). */
  officialSourcePresent: boolean;
  /** A legjobban megerősített állítás DISZTINKT forrásszáma (claim-merge.ts). */
  independentCorroboratingSourceCount: number;
  /** 0-1, a linkelt források átlagos megbízhatósági súlya (a meglévő `sourceReliabilityScore`-ral azonos képlet). */
  sourceReliabilityWeight: number;
  /** Van-e legalább egy közvetlen idézetet (vagy dokumentumra hivatkozó "other" tényt) tartalmazó állítás. */
  hasDirectQuoteOrDocument: boolean;
  hasContradiction: boolean;
  isDeveloping: boolean;
  /** Hány korábbi Story-frissítés (verzió) volt már. */
  priorUpdateCount: number;
}

export interface CredibilityScoreResult {
  score: number;
  band: CredibilityBand;
  justificationHu: string;
}

function corroborationPoints(count: number): number {
  if (count >= 3) return 25;
  if (count === 2) return 15;
  return 5;
}

/**
 * Hitelességi mutató v1 (2026-07-28-i sprint, a felhasználó specifikációja
 * szerint): "A pontszámítás vegye figyelembe: hivatalos forrás; független
 * megerősítések száma; forrás megbízhatósági súlya; közvetlen idézet/
 * dokumentum/közösségi poszt; ellentmondó forrás; információ frissessége;
 * korábbi Story-frissítések." Ez egy transzparens, súlyozott-összeg formula
 * — NEM egy ML-modell —, hogy minden pontszám emberileg visszakövethető és
 * a `justificationHu` mondatokból levezethető legyen. A maximálisan elérhető
 * pontszám (ellentmondás nélkül) 95 — pontosan a "Hivatalosan megerősített"
 * sáv alsó határa —, ami szándékos: csak akkor, ha MINDEN tényező egyszerre
 * teljesül.
 */
export function computeCredibilityScore(input: CredibilityScoreInput): CredibilityScoreResult {
  let score = 0;
  const reasons: string[] = [];

  if (input.officialSourcePresent) {
    score += 25;
    reasons.push("Hivatalos forrás (liga, klub vagy szövetség) is megerősítette.");
  }

  score += corroborationPoints(input.independentCorroboratingSourceCount);
  if (input.independentCorroboratingSourceCount >= 2) {
    reasons.push(
      `${input.independentCorroboratingSourceCount} független forrás egyezik meg legalább egy állításban.`,
    );
  }

  score += Math.round(input.sourceReliabilityWeight * 20);

  if (input.hasDirectQuoteOrDocument) {
    score += 10;
    reasons.push("Közvetlen idézet vagy dokumentum támasztja alá.");
  }

  score += input.isDeveloping ? 4 : 10;

  if (input.priorUpdateCount >= 1) {
    score += 5;
  }

  if (input.hasContradiction) {
    score -= 30;
    reasons.push("Ellentmondó információ található a forrásaink között.");
  }

  const clamped = Math.min(100, Math.max(0, Math.round(score)));
  const band = credibilityBandForScore(clamped);

  const justificationHu =
    reasons.length > 0
      ? reasons.join(" ")
      : "Egyetlen, még nem megerősített forrásból származó értesülés.";

  return { score: clamped, band, justificationHu };
}
