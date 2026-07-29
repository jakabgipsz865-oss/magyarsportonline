import type { CandidateStoryRow } from "@magyarsportonline/db";
import { describe, expect, it } from "vitest";
import { computeMissedMergeCandidatePairs } from "./missed-merge-candidates";

function story(overrides: Partial<CandidateStoryRow> & { storyId: string }): CandidateStoryRow {
  return {
    canonicalTitle: "Some Story",
    lastUpdatedAt: new Date("2026-07-28T12:00:00.000Z"),
    entities: [],
    rawArticleSourceUrls: ["https://www.bbc.co.uk/sport/football/articles/x"],
    ...overrides,
  };
}

const CHELSEA = { entityId: "team-chelsea", type: "team", nameCanonical: "Chelsea FC" };
const ARSENAL = { entityId: "team-arsenal", type: "team", nameCanonical: "Arsenal FC" };
const ALONSO = { entityId: "coach-alonso", type: "coach", nameCanonical: "Xabi Alonso" };
const PREMIER_LEAGUE = {
  entityId: "competition-pl",
  type: "competition",
  nameCanonical: "Premier League",
};

describe("computeMissedMergeCandidatePairs", () => {
  it("surfaces a pair sharing one specific entity on the exact same day", () => {
    const rows = [
      story({
        storyId: "a",
        entities: [{ ...CHELSEA, role: "subject" }],
        lastUpdatedAt: new Date("2026-07-28T09:00:00.000Z"),
      }),
      story({
        storyId: "b",
        entities: [{ ...CHELSEA, role: "subject" }],
        lastUpdatedAt: new Date("2026-07-28T18:00:00.000Z"),
      }),
    ];

    const result = computeMissedMergeCandidatePairs(rows);

    expect(result).toHaveLength(1);
    expect(result[0]?.candidateType).toBe("exact");
    expect(result[0]?.matchedEntities.map((e) => e.nameCanonical)).toEqual(["Chelsea FC"]);
    expect(new Set([result[0]?.storyAId, result[0]?.storyBId])).toEqual(new Set(["a", "b"]));
    expect(result[0]?.decisionReasonHu).toContain("Chelsea FC");
  });

  it("classifies a 1-day gap as adjacent", () => {
    const rows = [
      story({
        storyId: "a",
        entities: [{ ...CHELSEA, role: "subject" }],
        lastUpdatedAt: new Date("2026-07-27T23:50:00.000Z"),
      }),
      story({
        storyId: "b",
        entities: [{ ...CHELSEA, role: "subject" }],
        lastUpdatedAt: new Date("2026-07-28T00:10:00.000Z"),
      }),
    ];

    const result = computeMissedMergeCandidatePairs(rows);

    expect(result).toHaveLength(1);
    expect(result[0]?.candidateType).toBe("adjacent");
  });

  it("does not surface a pair more than 1 day apart", () => {
    const rows = [
      story({
        storyId: "a",
        entities: [{ ...CHELSEA, role: "subject" }],
        lastUpdatedAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
      story({
        storyId: "b",
        entities: [{ ...CHELSEA, role: "subject" }],
        lastUpdatedAt: new Date("2026-07-28T12:00:00.000Z"),
      }),
    ];

    expect(computeMissedMergeCandidatePairs(rows)).toHaveLength(0);
  });

  it("never surfaces a pair sharing only a generic entity (rule 1: competition-only is never sufficient)", () => {
    const rows = [
      story({ storyId: "a", entities: [{ ...PREMIER_LEAGUE, role: "mentioned" }] }),
      story({ storyId: "b", entities: [{ ...PREMIER_LEAGUE, role: "mentioned" }] }),
    ];

    expect(computeMissedMergeCandidatePairs(rows)).toHaveLength(0);
  });

  it("never surfaces a pair with a sport mismatch, even when both entity+day would otherwise qualify", () => {
    const rows = [
      story({
        storyId: "a",
        entities: [{ ...CHELSEA, role: "subject" }],
        rawArticleSourceUrls: ["https://www.skysports.com/darts/news/1"],
      }),
      story({
        storyId: "b",
        entities: [{ ...CHELSEA, role: "subject" }],
        rawArticleSourceUrls: ["https://www.skysports.com/football/news/1"],
      }),
    ];

    expect(computeMissedMergeCandidatePairs(rows)).toHaveLength(0);
  });

  it("produces all 3 pairs when 3 stories share the same specific entity", () => {
    const rows = [
      story({ storyId: "a", entities: [{ ...CHELSEA, role: "subject" }] }),
      story({ storyId: "b", entities: [{ ...CHELSEA, role: "subject" }] }),
      story({ storyId: "c", entities: [{ ...CHELSEA, role: "subject" }] }),
    ];

    const result = computeMissedMergeCandidatePairs(rows);
    expect(result).toHaveLength(3);
  });

  it("scores a 2-shared-specific-entity pair higher than a 1-shared-entity pair, and sorts best-first", () => {
    const rows = [
      story({ storyId: "low-a", entities: [{ ...CHELSEA, role: "subject" }] }),
      story({ storyId: "low-b", entities: [{ ...CHELSEA, role: "subject" }] }),
      story({
        storyId: "high-a",
        entities: [
          { ...CHELSEA, role: "subject" },
          { ...ALONSO, role: "subject" },
        ],
      }),
      story({
        storyId: "high-b",
        entities: [
          { ...CHELSEA, role: "subject" },
          { ...ALONSO, role: "subject" },
        ],
      }),
    ];

    const result = computeMissedMergeCandidatePairs(rows);
    const scores = result.map((r) => r.matchScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(result[0]?.matchScore).toBeGreaterThan(
      result.find((r) => r.storyAId === "low-a" || r.storyBId === "low-a")!.matchScore,
    );
  });

  it("never pairs stories with no shared specific entity even if they share a specific entity with a third story (differing entities recorded)", () => {
    const rows = [
      story({ storyId: "a", entities: [{ ...CHELSEA, role: "subject" }] }),
      story({ storyId: "b", entities: [{ ...ARSENAL, role: "subject" }] }),
    ];

    expect(computeMissedMergeCandidatePairs(rows)).toHaveLength(0);
  });
});
