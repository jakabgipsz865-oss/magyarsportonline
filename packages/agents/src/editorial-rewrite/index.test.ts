import { createEventEnvelope } from "@magyarsportonline/events";
import { FakeLlmClient } from "@magyarsportonline/llm";
import { createLogger } from "@magyarsportonline/observability";
import { describe, expect, it, vi } from "vitest";
import { handleStoryContentDrafted, type EditorialRewriteDeps } from "./index";

function storyVersion(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "v1",
    storyId: "story-1",
    versionNumber: 1,
    titleHu: "Liverpool nyert 3-1-re",
    leadHu: "A csapat nyert.",
    bodyHu: "Részletek a mérkőzésről.",
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
    qualityIssues: [{ field: "body", kind: "too_short" }],
    createdAt: new Date(),
    ...overrides,
  };
}

function buildDeps(overrides?: {
  llm?: FakeLlmClient;
  version?: ReturnType<typeof storyVersion>;
}): EditorialRewriteDeps & {
  emitted: unknown[];
  updateDraftContentCalls: unknown[];
} {
  const emitted: unknown[] = [];
  const updateDraftContentCalls: unknown[] = [];

  return {
    storyRepository: { getById: vi.fn(async () => ({ id: "story-1" }) as never) },
    storyVersionRepository: {
      getById: vi.fn(async () => overrides?.version ?? storyVersion()),
      updateDraftContent: vi.fn(async (versionId: string, content: unknown) => {
        updateDraftContentCalls.push({ versionId, ...(content as object) });
        return true;
      }),
    },
    factRepository: { listByStoryId: vi.fn(async () => []) },
    editorialCorrectionRepository: {
      listRecent: vi.fn(async () => []),
    },
    editorialCorrectionApplicationRepository: {
      create: vi.fn(),
    },
    llm: overrides?.llm ?? new FakeLlmClient(),
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
    updateDraftContentCalls,
  };
}

function triggerEvent() {
  return {
    ...createEventEnvelope({ correlationId: "77777777-7777-4777-8777-777777777777" }),
    type: "story/content.drafted" as const,
    payload: { story_id: "story-1", story_version_id: "v1", fact_consistency_score: 0.9 },
  };
}

describe("handleStoryContentDrafted (Editorial Rewrite Agent)", () => {
  it("uses zero LLM calls when the Writer draft already passed the deterministic quality gate", async () => {
    const llm = new FakeLlmClient();
    const deps = buildDeps({ llm, version: storyVersion({ qualityIssues: [] }) });

    await handleStoryContentDrafted(deps, triggerEvent());

    expect(llm.jsonRequests).toHaveLength(0);
    expect(deps.storyVersionRepository.updateDraftContent).not.toHaveBeenCalled();
    expect(deps.emitted).toEqual([
      expect.objectContaining({
        type: "story/editorial.rewritten",
        payload: { story_id: "story-1", story_version_id: "v1", editorial_rewrite_applied: false },
      }),
    ]);
  });

  it("uses zero LLM calls and preserves the Writer draft when quality issues remain", async () => {
    const llm = new FakeLlmClient();
    const deps = buildDeps({ llm });

    await handleStoryContentDrafted(deps, triggerEvent());

    expect(llm.jsonRequests).toHaveLength(0);
    expect(deps.storyVersionRepository.updateDraftContent).not.toHaveBeenCalled();
    expect(deps.emitted).toEqual([
      expect.objectContaining({
        type: "story/editorial.rewritten",
        payload: { story_id: "story-1", story_version_id: "v1", editorial_rewrite_applied: false },
      }),
    ]);
  });

  it("never rewrites an already-published version", async () => {
    const llm = new FakeLlmClient();
    const deps = buildDeps({ llm, version: storyVersion({ isPublished: true }) });

    await handleStoryContentDrafted(deps, triggerEvent());

    expect(llm.jsonRequests).toHaveLength(0);
    expect(deps.storyVersionRepository.updateDraftContent).not.toHaveBeenCalled();
    expect(deps.emitted).toEqual([
      expect.objectContaining({
        type: "story/editorial.rewritten",
        payload: { story_id: "story-1", story_version_id: "v1", editorial_rewrite_applied: false },
      }),
    ]);
  });

  it("throws when the Story cannot be found", async () => {
    const deps = buildDeps();
    deps.storyRepository.getById = vi.fn(async () => null);

    await expect(handleStoryContentDrafted(deps, triggerEvent())).rejects.toThrow("not found");
  });

  it("throws when the StoryVersion cannot be found", async () => {
    const deps = buildDeps();
    deps.storyVersionRepository.getById = vi.fn(async () => null);

    await expect(handleStoryContentDrafted(deps, triggerEvent())).rejects.toThrow("not found");
  });
});
