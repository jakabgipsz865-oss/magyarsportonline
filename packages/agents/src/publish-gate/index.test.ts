import { createEventEnvelope } from "@magyarsportonline/events";
import { createLogger } from "@magyarsportonline/observability";
import { describe, expect, it, vi } from "vitest";
import { handleStorySeoReady, type PublishGateDeps } from "./index";

function story(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "story-1",
    slug: "liverpool-nyert",
    canonicalTitle: "Liverpool vs Arsenal",
    status: "seo_ready" as const,
    riskLevel: "low" as const,
    confidenceScore: "0.700",
    categoryId: null,
    currentVersionId: null,
    versionCount: 1,
    firstSeenAt: new Date(),
    lastUpdatedAt: new Date(),
    publishedAt: null,
    isDeveloping: true,
    imageUrl: null,
    credibilityScore: 70,
    credibilityBand: "megerositett",
    credibilityLabelHu: "Megerősített",
    credibilityJustificationHu: "Megbízható forrásból származó értesülés.",
    credibilityOfficialConfirmed: false,
    credibilityCorroboratingCount: null,
    credibilityUpdatedAt: null,
    invalidMergeReasonHu: null,
    invalidatedAt: null,
    ...overrides,
  };
}

function fact(isContradicted: boolean) {
  return {
    id: "fact-1",
    storyId: "story-1",
    rawArticleId: "raw-1",
    factType: "score" as const,
    payload: {
      detail_hu: "A Liverpool 2-0-ra legyőzte az Arsenalt a bajnoki mérkőzésen.",
      quote_original: null,
      quote_speaker: null,
    },
    corroborationCount: 1,
    isContradicted,
    excluded: false,
    excludedReason: null,
    extractedAt: new Date(),
  };
}

function version(qualityIssues: unknown[] | null = null) {
  return {
    id: "v1",
    storyId: "story-1",
    versionNumber: 1,
    titleHu: "A Liverpool legyőzte az Arsenalt",
    leadHu: "A Liverpool kétgólos győzelmet aratott az Arsenal ellen a bajnokságban.",
    bodyHu:
      "A Liverpool végig irányította az Arsenal elleni bajnoki mérkőzést, és két góllal megérdemelt győzelmet aratott.",
    metaDescription: null,
    seoTags: null,
    structuredData: null,
    changeSummaryHu: null,
    generatedByModel: "claude-sonnet-5",
    isAiGenerated: true,
    promptVersion: "hungarian-writer@0.1.0",
    factConsistencyScore: "1.000",
    selfCheckFallback: false,
    editorialRewriteApplied: false,
    isPublished: false,
    qualityIssues,
    createdAt: new Date(),
  };
}

function sourceMeta(category: "tabloid" | "trusted_media" | "official" | null = "tabloid") {
  return {
    storyId: "story-1",
    rawArticleId: "raw-1",
    sourceId: "source-1",
    sourceName: "Daily Mail - Football",
    category,
    reliabilityTier: "C" as const,
    contributionType: "initial" as const,
    excluded: false,
    excludedReason: null,
  };
}

function buildDeps(overrides?: {
  story?: ReturnType<typeof story>;
  facts?: ReturnType<typeof fact>[];
  version?: ReturnType<typeof version>;
  forceReviewMode?: boolean;
  sourceMetas?: ReturnType<typeof sourceMeta>[];
}): PublishGateDeps & {
  emitted: unknown[];
  reviewQueueInserts: unknown[];
  statusUpdates: unknown[];
} {
  const emitted: unknown[] = [];
  const reviewQueueInserts: unknown[] = [];
  const statusUpdates: unknown[] = [];

  return {
    storyRepository: {
      getById: vi.fn(async () => overrides?.story ?? story()),
      publish: vi.fn(async () => undefined),
      updateStatus: vi.fn(async (storyId: string, status: string) => {
        statusUpdates.push({ storyId, status });
      }),
    },
    storyVersionRepository: {
      markPublished: vi.fn(async () => undefined),
      getById: vi.fn(async () => overrides?.version ?? version()),
    },
    forceReviewMode: overrides?.forceReviewMode ?? false,
    factRepository: { listByStoryId: vi.fn(async () => overrides?.facts ?? [fact(false)]) },
    storySourceRepository: {
      sourcesWithMetaByStoryId: vi.fn(async () => overrides?.sourceMetas ?? [sourceMeta()]),
    },
    reviewQueueRepository: {
      insert: vi.fn(async (input: unknown) => {
        reviewQueueInserts.push(input);
        return input as never;
      }),
    },
    agentRunRepository: { record: vi.fn(async () => undefined) },
    dispatcher: {
      emit: vi.fn(async (event: unknown) => {
        emitted.push(event);
      }),
    },
    logger: createLogger({
      destination: { write: () => true } as unknown as NodeJS.WritableStream,
    }),
    emitted,
    reviewQueueInserts,
    statusUpdates,
  };
}

function triggerEvent() {
  return {
    ...createEventEnvelope({ correlationId: "88888888-8888-4888-8888-888888888888" }),
    type: "story/seo.ready" as const,
    payload: { story_id: "story-1", story_version_id: "v1" },
  };
}

describe("handleStorySeoReady", () => {
  it("auto-publishes and emits story/published when the rule passes", async () => {
    const deps = buildDeps();

    await handleStorySeoReady(deps, triggerEvent());

    expect(deps.storyVersionRepository.markPublished).toHaveBeenCalledWith("v1");
    expect(deps.storyRepository.publish).toHaveBeenCalledWith("story-1", "v1", expect.any(Date));
    expect(deps.emitted).toEqual([
      expect.objectContaining({
        type: "story/published",
        payload: { story_id: "story-1", story_version_id: "v1" },
      }),
    ]);
    expect(deps.reviewQueueInserts).toEqual([]);
  });

  it("auto-publishes a readiness-passing single tabloid full article at 0.545 confidence", async () => {
    const deps = buildDeps({ story: story({ confidenceScore: "0.545" }) });

    await handleStorySeoReady(deps, triggerEvent());

    expect(deps.storyRepository.publish).toHaveBeenCalled();
    expect(deps.reviewQueueInserts).toEqual([]);
  });

  it("auto-publishes an RSS-only single-source Story when every other gate passes", async () => {
    const deps = buildDeps({ story: story({ confidenceScore: "0.545" }) });

    await handleStorySeoReady(deps, triggerEvent());

    expect(deps.storyRepository.publish).toHaveBeenCalled();
  });

  it("sends a high-risk story to review with reason high_risk", async () => {
    const deps = buildDeps({ story: story({ riskLevel: "high" }) });

    await handleStorySeoReady(deps, triggerEvent());

    expect(deps.reviewQueueInserts).toEqual([
      { storyId: "story-1", storyVersionId: "v1", reason: "high_risk" },
    ]);
    expect(deps.statusUpdates).toEqual([{ storyId: "story-1", status: "pending_review" }]);
    expect(deps.emitted).toEqual([
      expect.objectContaining({
        type: "story/review.requested",
        payload: { story_id: "story-1", reason: "high_risk" },
      }),
    ]);
    expect(deps.storyRepository.publish).not.toHaveBeenCalled();
  });

  it("re-derives has_contradiction from Fact rows and routes to review", async () => {
    const deps = buildDeps({ facts: [fact(true)] });

    await handleStorySeoReady(deps, triggerEvent());

    expect(deps.reviewQueueInserts).toEqual([
      { storyId: "story-1", storyVersionId: "v1", reason: "contradiction" },
    ]);
  });

  it("routes to review with reason force_review_mode when the operational kill switch is on, even for an otherwise-publishable story", async () => {
    const deps = buildDeps({ forceReviewMode: true });

    await handleStorySeoReady(deps, triggerEvent());

    expect(deps.reviewQueueInserts).toEqual([
      { storyId: "story-1", storyVersionId: "v1", reason: "force_review_mode" },
    ]);
    expect(deps.storyRepository.publish).not.toHaveBeenCalled();
  });

  it("routes to review with reason content_quality_failed when the version has unresolved Content Quality Gate issues", async () => {
    const deps = buildDeps({
      version: {
        ...version([{ field: "title", kind: "looks_english" }]),
        titleHu: "Liverpool beat Arsenal in the Premier League final",
      },
    });

    await handleStorySeoReady(deps, triggerEvent());

    expect(deps.reviewQueueInserts).toEqual([
      { storyId: "story-1", storyVersionId: "v1", reason: "content_quality_failed" },
    ]);
    expect(deps.storyRepository.publish).not.toHaveBeenCalled();
  });

  it("throws when the Story cannot be found", async () => {
    const deps = buildDeps();
    deps.storyRepository.getById = vi.fn(async () => null);

    await expect(handleStorySeoReady(deps, triggerEvent())).rejects.toThrow("not found");
  });
});
