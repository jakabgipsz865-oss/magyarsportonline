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
    ...overrides,
  };
}

function fact(isContradicted: boolean) {
  return {
    id: "fact-1",
    storyId: "story-1",
    rawArticleId: "raw-1",
    factType: "score" as const,
    payload: {},
    corroborationCount: 1,
    isContradicted,
    extractedAt: new Date(),
  };
}

function buildDeps(overrides?: {
  story?: ReturnType<typeof story>;
  facts?: ReturnType<typeof fact>[];
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
    storyVersionRepository: { markPublished: vi.fn(async () => undefined) },
    factRepository: { listByStoryId: vi.fn(async () => overrides?.facts ?? [fact(false)]) },
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

  it("throws when the Story cannot be found", async () => {
    const deps = buildDeps();
    deps.storyRepository.getById = vi.fn(async () => null);

    await expect(handleStorySeoReady(deps, triggerEvent())).rejects.toThrow("not found");
  });
});
