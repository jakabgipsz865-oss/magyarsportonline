import { describe, expect, it, vi } from "vitest";
import {
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
});
