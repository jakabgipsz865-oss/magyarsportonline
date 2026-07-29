import { describe, expect, it, vi } from "vitest";
import {
  claimDetailHu,
  recomputeCredibilityForStory,
  type RecomputeCredibilityDeps,
} from "./recompute-credibility";

const STORY = {
  id: "story-1",
  isDeveloping: false,
  versionCount: 0,
};

function fact(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "fact-1",
    storyId: STORY.id,
    rawArticleId: "raw-1",
    factType: "score" as const,
    payload: { detail_hu: "3-1", quote_original: null, quote_speaker: null },
    corroborationCount: 1,
    isContradicted: false,
    excluded: false,
    excludedReason: null,
    extractedAt: new Date(),
    ...overrides,
  };
}

function sourceMeta(overrides: Partial<Record<string, unknown>>) {
  return {
    storyId: STORY.id,
    rawArticleId: "raw-1",
    sourceId: "source-1",
    sourceName: "BBC Sport",
    category: null,
    reliabilityTier: "B" as const,
    contributionType: "initial" as const,
    excluded: false,
    excludedReason: null,
    ...overrides,
  };
}

function buildDeps(overrides: {
  facts: ReturnType<typeof fact>[];
  sourceMetas: ReturnType<typeof sourceMeta>[];
}): RecomputeCredibilityDeps & { updateCalls: unknown[]; historyInserts: unknown[] } {
  const updateCalls: unknown[] = [];
  const historyInserts: unknown[] = [];
  return {
    factRepository: {
      listByStoryId: vi.fn(async () => overrides.facts),
      bumpCorroboration: vi.fn(async () => undefined),
      listByStoryIdWithSourceName: vi.fn(async () => {
        const metaByRawArticleId = new Map(
          overrides.sourceMetas
            .filter((meta) => !meta.excluded)
            .map((meta) => [meta.rawArticleId, meta]),
        );
        return overrides.facts
          .filter((fact) => !fact.excluded)
          .flatMap((fact) => {
            const meta = metaByRawArticleId.get(fact.rawArticleId);
            if (!meta) return [];
            return [
              {
                id: fact.id,
                factType: fact.factType,
                payload: fact.payload,
                isContradicted: fact.isContradicted,
                corroborationCount: fact.corroborationCount,
                sourceId: meta.sourceId,
                sourceName: meta.sourceName,
                category: meta.category,
                reliabilityTier: meta.reliabilityTier,
                trustBaseline: null,
              },
            ];
          });
      }),
    },
    storySourceRepository: {
      sourcesWithMetaByStoryId: vi.fn(async () => overrides.sourceMetas),
    },
    storyRepository: {
      getById: vi.fn(async () => STORY as never),
      updateCredibilityResult: vi.fn(async (storyId: string, result: unknown) => {
        updateCalls.push({ storyId, ...(result as Record<string, unknown>) });
      }),
    },
    storyCredibilityHistoryRepository: {
      insert: vi.fn(async (row: unknown) => {
        historyInserts.push(row);
        return row as never;
      }),
    },
    updateCalls,
    historyInserts,
  };
}

describe("recomputeCredibilityForStory", () => {
  it("computes and persists a credibility result from a single non-official source", async () => {
    const deps = buildDeps({
      facts: [fact({})],
      sourceMetas: [sourceMeta({})],
    });

    const result = await recomputeCredibilityForStory(deps, STORY.id);

    expect(result.officialConfirmed).toBe(false);
    expect(result.corroboratingSourceCount).toBe(1);
    expect(deps.updateCalls).toHaveLength(1);
    expect(deps.historyInserts).toHaveLength(1);
  });

  it("detects official confirmation when a linked source has an official/league/club category", async () => {
    const deps = buildDeps({
      facts: [fact({})],
      sourceMetas: [sourceMeta({ category: "league" })],
    });

    const result = await recomputeCredibilityForStory(deps, STORY.id);

    expect(result.officialConfirmed).toBe(true);
  });

  it("excludes facts whose source link was admin-excluded from corroboration counting", async () => {
    const deps = buildDeps({
      facts: [
        fact({ id: "fact-1", rawArticleId: "raw-1" }),
        fact({ id: "fact-2", rawArticleId: "raw-2" }),
      ],
      sourceMetas: [
        sourceMeta({ rawArticleId: "raw-1", sourceId: "source-1" }),
        sourceMeta({ rawArticleId: "raw-2", sourceId: "source-2", excluded: true }),
      ],
    });

    const result = await recomputeCredibilityForStory(deps, STORY.id);

    // Only the non-excluded source's fact should count — corroboration stays at 1
    // even though two facts with matching text exist, because one is excluded.
    expect(result.corroboratingSourceCount).toBe(1);
  });

  it("resets a fact's stored corroborationCount back DOWN when a corroborating source is excluded", async () => {
    const deps = buildDeps({
      facts: [
        fact({ id: "fact-1", rawArticleId: "raw-1", corroborationCount: 2 }),
        fact({ id: "fact-2", rawArticleId: "raw-2", corroborationCount: 2, excluded: true }),
      ],
      sourceMetas: [
        sourceMeta({ rawArticleId: "raw-1", sourceId: "source-1" }),
        sourceMeta({ rawArticleId: "raw-2", sourceId: "source-2" }),
      ],
    });

    await recomputeCredibilityForStory(deps, STORY.id);

    // fact-1's stale corroborationCount=2 (from before fact-2 was excluded)
    // must be corrected back down to 1, not left stale.
    expect(deps.factRepository.bumpCorroboration).toHaveBeenCalledWith("fact-1", 1);
  });

  it("excludes admin-excluded facts (claims) entirely from the computation", async () => {
    const deps = buildDeps({
      facts: [
        fact({ id: "fact-1", rawArticleId: "raw-1" }),
        fact({ id: "fact-2", rawArticleId: "raw-2", excluded: true }),
      ],
      sourceMetas: [
        sourceMeta({ rawArticleId: "raw-1", sourceId: "source-1" }),
        sourceMeta({ rawArticleId: "raw-2", sourceId: "source-2" }),
      ],
    });

    const result = await recomputeCredibilityForStory(deps, STORY.id);

    expect(result.corroboratingSourceCount).toBe(1);
  });

  it("reflects an already-persisted contradiction flag without re-deriving it", async () => {
    const deps = buildDeps({
      facts: [fact({ isContradicted: true })],
      sourceMetas: [sourceMeta({})],
    });

    const result = await recomputeCredibilityForStory(deps, STORY.id);

    expect(result.justificationHu).toContain("Ellentmondó");
  });

  it("throws when the Story cannot be found", async () => {
    const deps = buildDeps({ facts: [], sourceMetas: [] });
    deps.storyRepository.getById = vi.fn(async () => null);

    await expect(recomputeCredibilityForStory(deps, "missing")).rejects.toThrow("not found");
  });

  it("returns a source breakdown with per-source claim counts across two distinct outlets", async () => {
    const deps = buildDeps({
      facts: [
        fact({ id: "fact-1", rawArticleId: "raw-1" }),
        fact({ id: "fact-2", rawArticleId: "raw-2" }),
      ],
      sourceMetas: [
        sourceMeta({ rawArticleId: "raw-1", sourceId: "source-1", sourceName: "BBC Sport" }),
        sourceMeta({ rawArticleId: "raw-2", sourceId: "source-2", sourceName: "Sky Sports" }),
      ],
    });

    const result = await recomputeCredibilityForStory(deps, STORY.id);

    expect(result.sourceBreakdown).toHaveLength(2);
    expect(result.sourceBreakdown.map((s) => s.name).sort()).toEqual(["BBC Sport", "Sky Sports"]);
    expect(result.sourceBreakdown.every((s) => s.factCount === 1)).toBe(true);
  });

  it("returns contradiction details naming both disagreeing sources", async () => {
    const deps = buildDeps({
      facts: [
        fact({
          id: "fact-1",
          rawArticleId: "raw-1",
          factType: "transfer_status",
          payload: { detail_hu: "35 millió euróért", quote_original: null, quote_speaker: null },
        }),
        fact({
          id: "fact-2",
          rawArticleId: "raw-2",
          factType: "transfer_status",
          payload: { detail_hu: "40 millió euróért", quote_original: null, quote_speaker: null },
        }),
      ],
      sourceMetas: [
        sourceMeta({ rawArticleId: "raw-1", sourceId: "source-1", sourceName: "Sky Sports" }),
        sourceMeta({ rawArticleId: "raw-2", sourceId: "source-2", sourceName: "BBC Sport" }),
      ],
    });

    const result = await recomputeCredibilityForStory(deps, STORY.id);

    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0]?.claims.map((c) => c.sourceName).sort()).toEqual([
      "BBC Sport",
      "Sky Sports",
    ]);
    expect(result.contradictions[0]?.statusHu).toBe("Nem megerősített átigazolási részlet");
  });

  it("returns a score breakdown whose entries sum to the final score (when no contradiction)", async () => {
    const deps = buildDeps({
      facts: [
        fact({ id: "fact-1", rawArticleId: "raw-1" }),
        fact({ id: "fact-2", rawArticleId: "raw-2" }),
      ],
      sourceMetas: [
        sourceMeta({ rawArticleId: "raw-1", sourceId: "source-1", sourceName: "BBC Sport" }),
        sourceMeta({ rawArticleId: "raw-2", sourceId: "source-2", sourceName: "Sky Sports" }),
      ],
    });

    const result = await recomputeCredibilityForStory(deps, STORY.id);

    const total = result.scoreBreakdown.reduce((sum, entry) => sum + entry.points, 0);
    expect(total).toBe(result.score);
  });

  it("regression: the score breakdown sums to the actual score even when two sources disagree (contradiction case)", async () => {
    // This is the exact scenario a real Postgres end-to-end run caught: two
    // sources each report a DIFFERENT transfer fee — each claim individually
    // has corroboratingSourceCount=1 (no real corroboration), which a buggy
    // "any fact tied at the max count" derivation used to wrongly merge into
    // a false 2-source corroboration signal, making the displayed breakdown
    // sum to a different number than the actual persisted score.
    const deps = buildDeps({
      facts: [
        fact({
          id: "fact-1",
          rawArticleId: "raw-1",
          factType: "transfer_status",
          payload: { detail_hu: "35 millió euróért", quote_original: null, quote_speaker: null },
          isContradicted: true,
        }),
        fact({
          id: "fact-2",
          rawArticleId: "raw-2",
          factType: "transfer_status",
          payload: { detail_hu: "40 millió euróért", quote_original: null, quote_speaker: null },
          isContradicted: true,
        }),
      ],
      sourceMetas: [
        sourceMeta({ rawArticleId: "raw-1", sourceId: "source-1", sourceName: "Sky Sports" }),
        sourceMeta({ rawArticleId: "raw-2", sourceId: "source-2", sourceName: "BBC Sport" }),
      ],
    });

    const result = await recomputeCredibilityForStory(deps, STORY.id);

    expect(result.corroboratingSourceCount).toBe(1);
    // The raw breakdown sum can go below 0 (a heavy contradiction penalty) —
    // the persisted score clamps to that floor, same as computeCredibilityScore.
    const rawTotal = result.scoreBreakdown.reduce((sum, entry) => sum + entry.points, 0);
    expect(result.score).toBe(Math.max(0, rawTotal));
    // Specifically: no entry should claim "2 independent sources agree" here
    // — that was the actual bug a real Postgres end-to-end run caught.
    expect(result.scoreBreakdown.some((e) => e.labelHu.includes("2 független forrás"))).toBe(false);
  });
});

describe("claimDetailHu", () => {
  it("prefers the verbatim quote for a quote fact", () => {
    const result = claimDetailHu({
      factType: "quote",
      payload: { detail_hu: "3-1", quote_original: "We played well." },
    });
    expect(result).toBe("We played well.");
  });

  it("falls back to the raw detail for a quote fact with no quote_original", () => {
    const result = claimDetailHu({
      factType: "quote",
      payload: { detail_hu: "3-1", quote_original: null },
    });
    expect(result).toBe("3-1");
  });

  it("prefers the raw detail for a non-quote fact even if a quote is present", () => {
    const result = claimDetailHu({
      factType: "score",
      payload: { detail_hu: "3-1", quote_original: "We played well." },
    });
    expect(result).toBe("3-1");
  });

  it("returns a placeholder when neither a quote nor a raw detail exists", () => {
    const result = claimDetailHu({ factType: "score", payload: {} });
    expect(result).toBe("(nincs részlet)");
  });
});
