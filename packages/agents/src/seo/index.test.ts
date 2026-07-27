import { createEventEnvelope } from "@magyarsportonline/events";
import { createLogger } from "@magyarsportonline/observability";
import { describe, expect, it, vi } from "vitest";
import { handleStoryContentDrafted, type SeoDeps } from "./index";

function story(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "story-1",
    slug: null,
    canonicalTitle: "Liverpool vs Arsenal",
    status: "written" as const,
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

function buildDeps(overrides?: {
  story?: ReturnType<typeof story>;
  trySetSlugResults?: boolean[];
}): SeoDeps & { emitted: unknown[]; slugAttempts: string[] } {
  const emitted: unknown[] = [];
  const slugAttempts: string[] = [];
  const results = overrides?.trySetSlugResults ?? [true];
  let call = 0;

  return {
    storyRepository: {
      getById: vi.fn(async () => overrides?.story ?? story()),
      trySetSlug: vi.fn(async (_storyId: string, slug: string) => {
        slugAttempts.push(slug);
        const result = results[Math.min(call, results.length - 1)] ?? true;
        call++;
        return result;
      }),
    },
    storyVersionRepository: {
      getLatest: vi.fn(async () => ({
        id: "v1",
        storyId: "story-1",
        versionNumber: 1,
        titleHu: "Liverpool nagy győzelmet aratott",
        leadHu: "Lead",
        bodyHu: "Body",
        metaDescription: null,
        seoTags: null,
        structuredData: null,
        changeSummaryHu: null,
        generatedByModel: "claude-sonnet-5",
        promptVersion: "hungarian-writer@0.1.0",
        factConsistencyScore: "1.000",
        isPublished: false,
        createdAt: new Date(),
      })),
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
    slugAttempts,
  };
}

function triggerEvent() {
  return {
    ...createEventEnvelope({ correlationId: "77777777-7777-4777-8777-777777777777" }),
    type: "story/content.drafted" as const,
    payload: { story_id: "story-1", story_version_id: "v1", fact_consistency_score: 0.9 },
  };
}

describe("handleStoryContentDrafted", () => {
  it("assigns a slug derived from the latest version's title and emits story/seo.ready", async () => {
    const deps = buildDeps();

    await handleStoryContentDrafted(deps, triggerEvent());

    expect(deps.slugAttempts).toEqual(["liverpool-nagy-gyozelmet-aratott"]);
    expect(deps.emitted).toEqual([
      expect.objectContaining({
        type: "story/seo.ready",
        payload: { story_id: "story-1", story_version_id: "v1" },
      }),
    ]);
  });

  it("retries with a numeric suffix on a slug collision", async () => {
    const deps = buildDeps({ trySetSlugResults: [false, false, true] });

    await handleStoryContentDrafted(deps, triggerEvent());

    expect(deps.slugAttempts).toEqual([
      "liverpool-nagy-gyozelmet-aratott",
      "liverpool-nagy-gyozelmet-aratott-2",
      "liverpool-nagy-gyozelmet-aratott-3",
    ]);
  });

  it("does not touch the slug when the Story already has one", async () => {
    const deps = buildDeps({ story: story({ slug: "already-set" }) });

    await handleStoryContentDrafted(deps, triggerEvent());

    expect(deps.storyRepository.trySetSlug).not.toHaveBeenCalled();
    expect(deps.emitted).toHaveLength(1);
  });

  it("throws when the Story cannot be found", async () => {
    const deps = buildDeps();
    deps.storyRepository.getById = vi.fn(async () => null);

    await expect(handleStoryContentDrafted(deps, triggerEvent())).rejects.toThrow("not found");
  });
});
