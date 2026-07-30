import { createEventEnvelope } from "@magyarsportonline/events";
import { FakeLlmClient, NoLlmClient } from "@magyarsportonline/llm";
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

const LEARNED_CORRECTION = {
  id: "correction-1",
  storyId: "some-other-story",
  category: "literal_translation" as const,
  termEn: null,
  originalSentenceEn: "The team won in a five-goal thriller.",
  currentSentenceHu: "gólos drámában nyert",
  correctedSentenceHu: "izgalmas, gólgazdag meccsen nyert",
  note: null,
  createdAt: new Date(),
};

function buildDeps(overrides?: {
  llm?: FakeLlmClient | NoLlmClient;
  version?: ReturnType<typeof storyVersion>;
  learnedCorrections?: (typeof LEARNED_CORRECTION)[];
}): EditorialRewriteDeps & {
  emitted: unknown[];
  updateDraftContentCalls: unknown[];
  applicationCreateCalls: unknown[];
} {
  const emitted: unknown[] = [];
  const updateDraftContentCalls: unknown[] = [];
  const applicationCreateCalls: unknown[] = [];

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
      listRecent: vi.fn(async () => overrides?.learnedCorrections ?? []),
    },
    editorialCorrectionApplicationRepository: {
      create: vi.fn(async (input: unknown) => {
        applicationCreateCalls.push(input);
        return {
          id: "application-1",
          correctionId: "correction-1",
          storyId: "story-1",
          stage: "editorial_rewrite" as const,
          verdict: "applied" as const,
          evidence: null,
          detectedAt: new Date(),
        };
      }),
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
    applicationCreateCalls,
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

  it("applies the rewrite and emits story/editorial.rewritten when the fact-check passes", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        rewritten_title_hu: "Bombagóllal nyert a Liverpool",
        rewritten_lead_hu: "A csapat magabiztosan győzött.",
        rewritten_body_hu: "Stilizált részletek.",
      },
      inputTokens: 10,
      outputTokens: 10,
    });
    llm.queueJson({
      data: { consistent: true, fact_consistency_score: 0.98, issues: [] },
      inputTokens: 5,
      outputTokens: 5,
    });
    const deps = buildDeps({ llm });

    await handleStoryContentDrafted(deps, triggerEvent());

    expect(deps.updateDraftContentCalls).toEqual([
      {
        versionId: "v1",
        titleHu: "Bombagóllal nyert a Liverpool",
        leadHu: "A csapat magabiztosan győzött.",
        bodyHu: "Stilizált részletek.",
        editorialRewriteApplied: true,
        qualityIssues: [],
      },
    ]);
    expect(deps.emitted).toEqual([
      expect.objectContaining({
        type: "story/editorial.rewritten",
        payload: { story_id: "story-1", story_version_id: "v1", editorial_rewrite_applied: true },
      }),
    ]);
  });

  it("discards the rewrite and keeps the original wording when the fact-check fails", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        rewritten_title_hu: "Kitalált cím egy plusz góllal",
        rewritten_lead_hu: "Kitalált lead.",
        rewritten_body_hu: "Kitalált törzs.",
      },
      inputTokens: 10,
      outputTokens: 10,
    });
    llm.queueJson({
      data: {
        consistent: false,
        fact_consistency_score: 0.2,
        issues: ["a cím egy nem létező gólt említ"],
      },
      inputTokens: 5,
      outputTokens: 5,
    });
    const deps = buildDeps({ llm });

    await handleStoryContentDrafted(deps, triggerEvent());

    expect(deps.storyVersionRepository.updateDraftContent).not.toHaveBeenCalled();
    expect(deps.emitted).toEqual([
      expect.objectContaining({
        type: "story/editorial.rewritten",
        payload: { story_id: "story-1", story_version_id: "v1", editorial_rewrite_applied: false },
      }),
    ]);
  });

  it("skips the rewrite entirely for the No-LLM client, keeping the original content", async () => {
    const deps = buildDeps({ llm: new NoLlmClient() });

    await handleStoryContentDrafted(deps, triggerEvent());

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

  it("records an 'applied' correction-application event when the rewrite drops a flagged literal translation", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        rewritten_title_hu: "Bombagóllal nyert a Liverpool",
        rewritten_lead_hu: "A csapat izgalmas, gólgazdag meccsen nyert.",
        rewritten_body_hu: "Stilizált részletek.",
      },
      inputTokens: 10,
      outputTokens: 10,
    });
    llm.queueJson({
      data: { consistent: true, fact_consistency_score: 0.98, issues: [] },
      inputTokens: 5,
      outputTokens: 5,
    });
    const deps = buildDeps({
      llm,
      version: storyVersion({ bodyHu: "A csapat gólos drámában nyert." }),
      learnedCorrections: [LEARNED_CORRECTION],
    });

    await handleStoryContentDrafted(deps, triggerEvent());

    expect(deps.applicationCreateCalls).toEqual([
      expect.objectContaining({
        correctionId: "correction-1",
        storyId: "story-1",
        stage: "editorial_rewrite",
        verdict: "applied",
      }),
    ]);
  });

  it("records a 'not_applied' correction-application event when the rewrite keeps the flagged literal translation", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        rewritten_title_hu: "Bombagóllal nyert a Liverpool",
        rewritten_lead_hu: "A csapat gólos drámában nyert.",
        rewritten_body_hu: "Stilizált részletek.",
      },
      inputTokens: 10,
      outputTokens: 10,
    });
    llm.queueJson({
      data: { consistent: true, fact_consistency_score: 0.98, issues: [] },
      inputTokens: 5,
      outputTokens: 5,
    });
    const deps = buildDeps({
      llm,
      version: storyVersion({ bodyHu: "A csapat gólos drámában nyert." }),
      learnedCorrections: [LEARNED_CORRECTION],
    });

    await handleStoryContentDrafted(deps, triggerEvent());

    expect(deps.applicationCreateCalls).toEqual([
      expect.objectContaining({ correctionId: "correction-1", verdict: "not_applied" }),
    ]);
  });

  it("never measures correction application when the rewrite is discarded (fact-check failed)", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        rewritten_title_hu: "Kitalált cím",
        rewritten_lead_hu: "Kitalált lead.",
        rewritten_body_hu: "Kitalált törzs.",
      },
      inputTokens: 10,
      outputTokens: 10,
    });
    llm.queueJson({
      data: { consistent: false, fact_consistency_score: 0.2, issues: ["hiba"] },
      inputTokens: 5,
      outputTokens: 5,
    });
    const deps = buildDeps({ llm, learnedCorrections: [LEARNED_CORRECTION] });

    await handleStoryContentDrafted(deps, triggerEvent());

    expect(deps.applicationCreateCalls).toHaveLength(0);
  });

  it("never measures correction application for the No-LLM client", async () => {
    const deps = buildDeps({ llm: new NoLlmClient(), learnedCorrections: [LEARNED_CORRECTION] });

    await handleStoryContentDrafted(deps, triggerEvent());

    expect(deps.applicationCreateCalls).toHaveLength(0);
  });
});
