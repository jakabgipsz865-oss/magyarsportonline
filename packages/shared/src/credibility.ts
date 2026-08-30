/**
 * Hitelességi mutató v1 sávjai (2026-07-28-i "Hitelességi mutató" sprint,
 * a felhasználó explicit specifikációja szerint): egy 0-100 pontszámot öt,
 * emberileg érthető sávba sorol. Megosztott a `packages/agents` (számítás)
 * és a `apps/web` (megjelenítés) között, hogy a két oldal sosem tudjon
 * szétcsúszni a határértékeken.
 */
export interface CredibilityBand {
  slug: "official_confirmed" | "strong_corroboration" | "likely" | "unconfirmed" | "speculation";
  labelHu: string;
  min: number;
  max: number;
}

export const CREDIBILITY_BANDS: readonly CredibilityBand[] = [
  { slug: "official_confirmed", labelHu: "Hivatalosan megerősített", min: 95, max: 100 },
  { slug: "strong_corroboration", labelHu: "Több erős forrás megerősíti", min: 80, max: 94 },
  { slug: "likely", labelHu: "Valószínű", min: 60, max: 79 },
  { slug: "unconfirmed", labelHu: "Nem megerősített értesülés", min: 35, max: 59 },
  { slug: "speculation", labelHu: "Spekuláció", min: 0, max: 34 },
];

/** A pontszámhoz tartozó sáv — a `CREDIBILITY_BANDS` tömb kimerítő, tehát ez sosem ad vissza `undefined`-et. */
export function credibilityBandForScore(score: number): CredibilityBand {
  const clamped = Math.min(100, Math.max(0, Math.round(score)));
  const band = CREDIBILITY_BANDS.find((entry) => clamped >= entry.min && clamped <= entry.max);
  return band ?? CREDIBILITY_BANDS[CREDIBILITY_BANDS.length - 1]!;
}

export type PublicCredibilityLevel = 1 | 2 | 3 | 4 | 5;

export interface PublicCredibilityRating {
  level: PublicCredibilityLevel;
  labelHu: string;
  slug: "speculative" | "rumour" | "reported" | "strong_source" | "official";
}

const PUBLIC_CREDIBILITY_RATINGS: Record<PublicCredibilityLevel, PublicCredibilityRating> = {
  1: { level: 1, labelHu: "Spekulatív / gyenge alátámasztás", slug: "speculative" },
  2: { level: 2, labelHu: "Pletyka / korlátozott bizonyosság", slug: "rumour" },
  3: { level: 3, labelHu: "Forrásértesülés / mérsékelt bizonyosság", slug: "reported" },
  4: { level: 4, labelHu: "Erős, megbízható forrás", slug: "strong_source" },
  5: { level: 5, labelHu: "Hivatalosan / közvetlenül megerősített", slug: "official" },
};

export function publicCredibilityRating(input: {
  officialConfirmed: boolean;
  sourceReliabilityTiers: readonly string[];
  independentCorroborationCount: number;
  hasContradiction: boolean;
}): PublicCredibilityRating {
  const tiers = new Set(input.sourceReliabilityTiers);
  let level = input.officialConfirmed
    ? 5
    : tiers.has("A")
      ? 4
      : tiers.has("B")
        ? 3
        : tiers.has("C")
          ? 2
          : 1;

  if (!input.officialConfirmed && input.independentCorroborationCount > 0) {
    level = Math.min(4, level + 1);
  }
  if (input.hasContradiction) {
    level = Math.min(2, level);
  }

  return PUBLIC_CREDIBILITY_RATINGS[level as PublicCredibilityLevel];
}
