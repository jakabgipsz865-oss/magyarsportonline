import { describe, expect, it } from "vitest";
import {
  fiveMinuteBucket,
  pickTrending,
  rankTrending,
  scoreTrending,
  type TrendingCounts,
  type TrendingSnapshot,
} from "./trending";

const now = new Date("2026-09-29T12:04:00.000Z");

function row(id: string, overrides: Partial<TrendingCounts> = {}): TrendingCounts {
  return {
    storyId: id,
    slug: id,
    publishedAt: "2026-09-29T10:00:00.000Z",
    hasImage: true,
    normal1h: 0,
    promoted1h: 0,
    normal6h: 0,
    promoted6h: 0,
    normal24h: 0,
    promoted24h: 0,
    ...overrides,
  };
}

function snapshot(rows: TrendingCounts[], refreshedAt = now.toISOString()): TrendingSnapshot {
  return { refreshedAt, ranking: rankTrending(rows) };
}

describe("trending score and selection", () => {
  it("prioritizes a fresh surge over a large older 24h total", () => {
    const fresh = row("fresh", { normal1h: 8, normal6h: 8, normal24h: 8 });
    const old = row("old", { normal24h: 55 });
    expect(rankTrending([old, fresh]).map((item) => item.storyId)).toEqual(["fresh", "old"]);
    expect(scoreTrending(fresh)).toBe(64);
  });

  it("downweights self-promoted reads instead of creating a positive feedback loop", () => {
    expect(scoreTrending(row("a", { promoted1h: 8, promoted6h: 8, promoted24h: 8 }))).toBe(16);
    expect(scoreTrending(row("b", { normal1h: 8, normal6h: 8, normal24h: 8 }))).toBe(64);
  });

  it("requires five reads, age 15m–24h, and a recent snapshot for a hero", () => {
    expect(pickTrending(snapshot([row("low", { normal24h: 4 })]), now).heroId).toBeNull();
    expect(
      pickTrending(
        snapshot([
          row("new", {
            publishedAt: "2026-09-29T11:55:00.000Z",
            normal24h: 5,
          }),
        ]),
        now,
      ).heroId,
    ).toBeNull();
    expect(
      pickTrending(
        snapshot([
          row("expired", {
            publishedAt: "2026-09-28T11:00:00.000Z",
            normal24h: 5,
          }),
        ]),
        now,
      ).heroId,
    ).toBeNull();
    expect(
      pickTrending(snapshot([row("good", { normal24h: 5 })], "2026-09-29T11:50:00.000Z"), now)
        .heroId,
    ).toBeNull();
    expect(pickTrending(snapshot([row("good", { normal24h: 5 })]), now).heroId).toBe("good");
    expect(
      pickTrending(
        snapshot([
          row("no-image", { normal24h: 8, hasImage: false }),
          row("pictured", { normal24h: 5 }),
        ]),
        now,
      ).heroId,
    ).toBe("pictured");
  });

  it("deduplicates hero, side and top five when sufficient alternatives exist", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row(`story-${index}`, { normal1h: 10 - index, normal6h: 10 - index, normal24h: 10 - index }),
    );
    const picked = pickTrending(snapshot(rows), now);
    expect(picked.heroId).toBe("story-0");
    expect(picked.sideIds).toEqual(["story-1", "story-2", "story-3"]);
    expect(picked.topFiveIds).toEqual(["story-4", "story-5", "story-6", "story-7", "story-8"]);
    expect(new Set([picked.heroId, ...picked.sideIds, ...picked.topFiveIds]).size).toBe(9);
  });

  it("uses a five-minute moving window across midnight", () => {
    expect(fiveMinuteBucket(new Date("2026-09-30T00:02:49Z"))).toBe("2026-09-30T00:00:00.000Z");
    expect(fiveMinuteBucket(new Date("2026-09-29T23:59:59Z"))).toBe("2026-09-29T23:55:00.000Z");
  });
});
