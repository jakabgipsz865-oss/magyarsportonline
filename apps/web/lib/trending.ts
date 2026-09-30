export const READ_SOURCES = [
  "latest",
  "trending_hero",
  "trending_side",
  "top5",
  "social",
  "search",
  "direct",
  "rss",
  "internal",
] as const;

export type ReadSource = (typeof READ_SOURCES)[number];

export interface TrendingCounts {
  storyId: string;
  slug: string;
  publishedAt: string;
  hasImage: boolean;
  normal1h: number;
  promoted1h: number;
  normal6h: number;
  promoted6h: number;
  normal24h: number;
  promoted24h: number;
}

export interface TrendingRank extends TrendingCounts {
  score: number;
  position: number;
}

export interface TrendingSnapshot {
  refreshedAt: string;
  ranking: TrendingRank[];
  hero?: { storyId: string; selectedAt: string } | null;
}

const PROMOTED_WEIGHT = 0.25;
export const HERO_HOLD_MS = 30 * 60_000;
export const HERO_CHALLENGER_RATIO = 1.25;

export function heroEligible(row: TrendingCounts, now: Date): boolean {
  const age = now.getTime() - new Date(row.publishedAt).getTime();
  return row.hasImage && age >= 15 * 60_000 && age <= 24 * 3_600_000;
}

/** Ranking rows have already passed the public/renderable database filter. */
export function selectTrendingHero(
  ranking: TrendingRank[],
  previous: TrendingSnapshot["hero"],
  now: Date,
): NonNullable<TrendingSnapshot["hero"]> | null {
  const challenger = ranking.find(
    (row) => heroEligible(row, now) && row.normal24h + row.promoted24h >= 5,
  );
  const current = previous && ranking.find((row) => row.storyId === previous.storyId);
  if (current && heroEligible(current, now)) {
    const held = now.getTime() - new Date(previous!.selectedAt).getTime();
    if (!Number.isFinite(held) || held < 0)
      return challenger ? { storyId: challenger.storyId, selectedAt: now.toISOString() } : null;
    if (held < HERO_HOLD_MS) return previous!;
    if (!challenger) return null;
    if (challenger.storyId === current.storyId) return previous!;
    if (challenger.score < current.score * HERO_CHALLENGER_RATIO) return previous!;
  }
  return challenger ? { storyId: challenger.storyId, selectedAt: now.toISOString() } : null;
}

export function scoreTrending(row: TrendingCounts): number {
  return (
    5 * (row.normal1h + PROMOTED_WEIGHT * row.promoted1h) +
    2 * (row.normal6h + PROMOTED_WEIGHT * row.promoted6h) +
    row.normal24h +
    PROMOTED_WEIGHT * row.promoted24h
  );
}

export function rankTrending(rows: TrendingCounts[]): TrendingRank[] {
  return rows
    .filter((row) => row.normal24h + row.promoted24h > 0)
    .map((row) => ({ ...row, score: scoreTrending(row), position: 0 }))
    .sort((a, b) => b.score - a.score || b.publishedAt.localeCompare(a.publishedAt))
    .map((row, index) => ({ ...row, position: index + 1 }));
}

export function pickTrending(
  snapshot: TrendingSnapshot | null,
  now: Date,
): {
  heroId: string | null;
  sideIds: string[];
  topFiveIds: string[];
} {
  const empty = { heroId: null, sideIds: [], topFiveIds: [] };
  if (!snapshot) return empty;
  const age = now.getTime() - new Date(snapshot.refreshedAt).getTime();
  if (!Number.isFinite(age) || age < -60_000 || age > 12 * 60_000) return empty;

  const seen = new Set<string>();
  const unique = snapshot.ranking.filter((row) => {
    if (seen.has(row.storyId)) return false;
    seen.add(row.storyId);
    return true;
  });
  // Editorial presentation needs an actual lead image; no-image stories still
  // keep their measured rank in diagnostics and the chronological feed.
  const pictured = unique.filter((row) => row.hasImage);
  const eligible = pictured.filter((row) => {
    const storyAge = now.getTime() - new Date(row.publishedAt).getTime();
    return (
      storyAge >= 15 * 60_000 &&
      storyAge <= 24 * 60 * 60_000 &&
      row.normal24h + row.promoted24h >= 5
    );
  });
  const heroId =
    snapshot.hero === undefined
      ? (eligible[0]?.storyId ?? null)
      : snapshot.hero &&
          pictured.some((row) => row.storyId === snapshot.hero!.storyId && heroEligible(row, now))
        ? snapshot.hero.storyId
        : null;
  if (!heroId) return empty;

  const sideIds = eligible
    .filter((row) => row.storyId !== heroId)
    .slice(0, 3)
    .map((row) => row.storyId);
  const used = new Set([heroId, ...sideIds]);
  const otherTop = pictured.filter((row) => !used.has(row.storyId));
  const topFiveIds = (
    otherTop.length >= 5 ? otherTop : pictured.filter((row) => row.storyId !== heroId)
  )
    .slice(0, 5)
    .map((row) => row.storyId);
  return { heroId, sideIds, topFiveIds };
}

export function fiveMinuteBucket(now: Date): string {
  const milliseconds = now.getTime();
  return new Date(Math.floor(milliseconds / 300_000) * 300_000).toISOString();
}
