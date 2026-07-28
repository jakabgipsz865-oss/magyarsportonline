import type { SourceCategory, SourceReliabilityTier } from "@magyarsportonline/shared";
import type { ClaimMergeResult } from "./claim-merge";
import { detailOf, rawDetailOf } from "./contradiction-check";

/**
 * Hitelesség-magyarázat réteg (2026-07-28-i bővítés, a felhasználó explicit
 * kérésére): "Nem csak egy szám. Hanem magyarázza el, hogy miért annyi a
 * pont." Ez a modul a `credibility-score.ts` absztrakt (szám/boolean)
 * bemenetei helyett a TÉNYLEGES állítás- és forrás-adatokból épít
 * emberileg olvasható, forrásra hivatkozó magyarázatot — mind a publikus
 * Story-oldalnak (`/hir/[slug]`), mind a bizonyító riportnak
 * (proof-report) ugyanazokkal a függvényekkel, hogy a kettő sosem tud
 * szétcsúszni.
 */

export interface FactForExplanation {
  id: string;
  factType: string;
  payload: unknown;
  isContradicted: boolean;
  sourceId: string;
  sourceName: string;
  category: SourceCategory | null;
  reliabilityTier: SourceReliabilityTier;
  trustBaseline: number | null;
}

export interface SourceBreakdownItem {
  sourceId: string;
  name: string;
  category: SourceCategory | null;
  badgeEmoji: string;
  reliabilityDisplayScore: number;
  factCount: number;
  factCountLabelHu: string;
}

export interface ContradictionDetail {
  factType: string;
  factTypeLabelHu: string;
  claims: Array<{ sourceName: string; detailHu: string }>;
  statusHu: string;
}

export interface ScoreBreakdownEntry {
  labelHu: string;
  points: number;
}

export const FACT_TYPE_LABELS_HU: Record<string, string> = {
  score: "végeredmény",
  quote: "idézet",
  injury_status: "sérülés-státusz",
  transfer_status: "átigazolási részlet",
  event_time: "időpont",
  other: "adat",
};

const OFFICIAL_CATEGORIES = new Set<SourceCategory>(["official", "league", "club"]);

const CATEGORY_BADGE_EMOJI: Record<SourceCategory, string> = {
  official: "🟡",
  league: "🟡",
  club: "🟡",
  trusted_media: "🟢",
  tabloid: "🟢",
  social: "💬",
  data_api: "📊",
};

const RELIABILITY_TIER_DISPLAY_SCORE: Record<SourceReliabilityTier, number> = {
  A: 95,
  B: 70,
  C: 40,
};

/** Egy forrás megjelenítendő 0-100 megbízhatósági pontja — a dokumentált `trustBaseline`-t részesíti előnyben, tier-alapú alapértelmezéssel, ha nincs dokumentálva. */
export function reliabilityDisplayScore(
  tier: SourceReliabilityTier,
  trustBaseline: number | null,
): number {
  return trustBaseline ?? RELIABILITY_TIER_DISPLAY_SCORE[tier];
}

function isOfficial(category: SourceCategory | null): boolean {
  return category !== null && OFFICIAL_CATEGORIES.has(category);
}

/** Forrásonkénti bontás: hány állítás származik onnan, milyen kategóriájú/megbízhatóságú forrás. */
export function buildSourceBreakdown(facts: FactForExplanation[]): SourceBreakdownItem[] {
  const bySource = new Map<string, FactForExplanation[]>();
  for (const fact of facts) {
    const group = bySource.get(fact.sourceId) ?? [];
    group.push(fact);
    bySource.set(fact.sourceId, group);
  }

  return [...bySource.entries()].map(([sourceId, group]) => {
    const first = group[0]!;
    const official = isOfficial(first.category);
    return {
      sourceId,
      name: first.sourceName,
      category: first.category,
      badgeEmoji: first.category ? CATEGORY_BADGE_EMOJI[first.category] : "🔵",
      reliabilityDisplayScore: reliabilityDisplayScore(first.reliabilityTier, first.trustBaseline),
      factCount: group.length,
      factCountLabelHu: official
        ? `${group.length} hivatalos közlemény`
        : `${group.length} állítás`,
    };
  });
}

const COMPARABLE_FACT_TYPES = new Set(["score", "injury_status", "transfer_status", "event_time"]);

/** Az ellentmondó állítás-csoportok részletezése: melyik forrás mit állított, és mi a jelenlegi (nem megerősített) állapot. */
export function buildContradictionDetails(facts: FactForExplanation[]): ContradictionDetail[] {
  const byFactType = new Map<string, FactForExplanation[]>();
  for (const fact of facts) {
    if (!COMPARABLE_FACT_TYPES.has(fact.factType)) {
      continue;
    }
    const group = byFactType.get(fact.factType) ?? [];
    group.push(fact);
    byFactType.set(fact.factType, group);
  }

  const details: ContradictionDetail[] = [];
  for (const [factType, group] of byFactType) {
    const distinctNormalized = new Set(
      group
        .map((fact) => detailOf(fact.payload))
        .filter((detail): detail is string => detail !== null),
    );
    if (distinctNormalized.size <= 1) {
      continue;
    }
    const seen = new Set<string>();
    const claims: Array<{ sourceName: string; detailHu: string }> = [];
    for (const fact of group) {
      const raw = rawDetailOf(fact.payload);
      if (raw === null) continue;
      const key = `${fact.sourceName}|${raw.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      claims.push({ sourceName: fact.sourceName, detailHu: raw });
    }
    const labelHu = FACT_TYPE_LABELS_HU[factType] ?? factType;
    details.push({
      factType,
      factTypeLabelHu: labelHu,
      claims,
      statusHu: `Nem megerősített ${labelHu}`,
    });
  }
  return details;
}

/**
 * A legjobban megerősített ÁLLÍTÁS (nem csak "bármelyik legmagasabb
 * darabszámú tény") forrásainak neve — kritikus, hogy a `groupKeyByFactId`
 * alapján a TÉNYLEGES állítás-csoportot azonosítsuk, ne csak azt, hogy egy
 * tény önmagában elérte a maximális darabszámot. Enélkül két, EGYMÁSNAK
 * ELLENTMONDÓ, de véletlenül azonos (pl. 1-es) forrásszámú állítás
 * forrásai tévesen összeolvadnának egyetlen "megerősítő" listává — pontosan
 * ez a hiba történt ennek a bővítésnek egy korábbi, valós Postgres elleni
 * tesztelés során felfedezett verziójában (lásd git history).
 */
export function winningGroupSourceNames(
  facts: FactForExplanation[],
  claimMerge: Pick<
    ClaimMergeResult,
    "corroboratingSourceCountByFactId" | "groupKeyByFactId" | "maxCorroboratingSourceCount"
  >,
): string[] {
  if (claimMerge.maxCorroboratingSourceCount < 2) {
    // Nincs valódi, egynél több forrás által megerősített állítás — a
    // megjelenítés ilyenkor "egyetlen forrásból származik" szöveget mutat,
    // forrásnév-lista nélkül.
    return [];
  }
  const winningFactId = [...claimMerge.corroboratingSourceCountByFactId.entries()].find(
    ([, count]) => count === claimMerge.maxCorroboratingSourceCount,
  )?.[0];
  const winningGroupKey = winningFactId
    ? claimMerge.groupKeyByFactId.get(winningFactId)
    : undefined;
  if (!winningGroupKey) {
    return [];
  }
  return [
    ...new Set(
      facts
        .filter((fact) => claimMerge.groupKeyByFactId.get(fact.id) === winningGroupKey)
        .map((fact) => fact.sourceName),
    ),
  ];
}

export interface ScoreBreakdownInput {
  officialSourcePresent: boolean;
  officialSourceNames: string[];
  corroboratingSourceNames: string[];
  reliabilitySummaryHu: string;
  reliabilityPoints: number;
  hasDirectQuoteOrDocument: boolean;
  hasContradiction: boolean;
  contradictionSourceNames: string[];
  isDeveloping: boolean;
  priorUpdateCount: number;
}

/** Forrásra hivatkozó, olvasható indoklás-sorok a hitelességi pont minden összetevőjéhez — melyik forrás növelte/csökkentette a pontot és miért. */
export function buildScoreBreakdown(input: ScoreBreakdownInput): ScoreBreakdownEntry[] {
  const entries: ScoreBreakdownEntry[] = [];

  if (input.officialSourcePresent) {
    entries.push({
      labelHu: `Hivatalos forrás megerősítette (${input.officialSourceNames.join(", ")})`,
      points: 25,
    });
  }

  const corroborationCount = input.corroboratingSourceNames.length;
  const corroborationPoints = corroborationCount >= 3 ? 25 : corroborationCount === 2 ? 15 : 5;
  entries.push({
    labelHu:
      corroborationCount >= 2
        ? `${corroborationCount} független forrás egyezik meg (${input.corroboratingSourceNames.join(", ")})`
        : "Egyetlen forrásból származik, még nincs független megerősítés",
    points: corroborationPoints,
  });

  entries.push({
    labelHu: `Forrás-megbízhatóság átlaga (${input.reliabilitySummaryHu})`,
    points: input.reliabilityPoints,
  });

  if (input.hasDirectQuoteOrDocument) {
    entries.push({ labelHu: "Közvetlen idézet vagy dokumentum támasztja alá", points: 10 });
  }

  entries.push({
    labelHu: input.isDeveloping
      ? "A hír még alakul, friss fejlemény"
      : "A hír már nem fejlődő, stabil",
    points: input.isDeveloping ? 4 : 10,
  });

  if (input.priorUpdateCount >= 1) {
    entries.push({ labelHu: "A Story korábban már frissült, bevált forrásokkal", points: 5 });
  }

  if (input.hasContradiction) {
    entries.push({
      labelHu:
        input.contradictionSourceNames.length > 0
          ? `Ellentmondás a forrásaink között (${input.contradictionSourceNames.join(", ")})`
          : "Ellentmondás található a forrásaink között",
      points: -30,
    });
  }

  return entries;
}
