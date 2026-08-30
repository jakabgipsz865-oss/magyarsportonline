import {
  EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
  type EditorialKnowledgeRecord,
  type Fact,
  type NewStoryVersionInput,
  type StoryVersion,
} from "@magyarsportonline/db";
import { createEventEnvelope } from "@magyarsportonline/events";
import {
  FakeLlmClient,
  MODEL_TIERS,
  NO_LLM_MODEL_LABEL,
  NoLlmClient,
} from "@magyarsportonline/llm";
import { createLogger } from "@magyarsportonline/observability";
import { describe, expect, it, vi } from "vitest";
import { handleStoryFactsVerified, type HungarianWriterDeps } from "./index";

const STORY = {
  id: "story-1",
  slug: null,
  canonicalTitle: "Liverpool vs Arsenal",
  status: "fact_checked" as const,
  riskLevel: "low" as const,
  confidenceScore: "0.700",
  categoryId: null,
  currentVersionId: null,
  versionCount: 0,
  firstSeenAt: new Date(),
  lastUpdatedAt: new Date(),
  publishedAt: null,
  isDeveloping: true,
  imageUrl: null,
  credibilityScore: null,
  credibilityBand: null,
  credibilityLabelHu: null,
  credibilityJustificationHu: null,
  credibilityOfficialConfirmed: false,
  credibilityCorroboratingCount: null,
  credibilityUpdatedAt: null,
  invalidMergeReasonHu: null,
  invalidatedAt: null,
};

const FACT: Fact = {
  id: "fact-1",
  storyId: STORY.id,
  rawArticleId: "raw-1",
  factType: "score",
  payload: { detail_hu: "3-1", quote_original: null, quote_speaker: null },
  corroborationCount: 1,
  isContradicted: false,
  excluded: false,
  excludedReason: null,
  extractedAt: new Date(),
};

const V2_KNOWLEDGE: EditorialKnowledgeRecord = {
  schema_version: EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
  stable_key: "football.mwe.super-sub",
  revision: 1,
  knowledge_type: "multi_word_expression",
  language: { source: "en", target: "hu" },
  sport: "football",
  contexts: ["quote"],
  source_phrase: "super-sub",
  canonical_hu: "eredményes csereember",
  alternative_hu: [],
  avoid_hu: ["szuper csere"],
  instruction_hu: null,
  match_terms: ["super-sub"],
  confidence: 1,
  status: "active",
  provenance: { source: "test fixture", source_url: null, license: "editorial-original" },
  editorial_note: null,
  positive_examples: [],
  negative_examples: [],
  replaced_by: null,
};

function buildDeps(overrides?: {
  previousVersion?: { titleHu: string; leadHu: string; bodyHu: string } | null;
  knowledge?: EditorialKnowledgeRecord[];
}): HungarianWriterDeps & {
  emitted: unknown[];
  createNextVersionCalls: unknown[];
  llm: FakeLlmClient;
} {
  const emitted: unknown[] = [];
  const createNextVersionCalls: unknown[] = [];
  const llm = new FakeLlmClient();

  const previousVersion =
    overrides?.previousVersion === undefined
      ? null
      : overrides.previousVersion
        ? {
            id: "prev-version",
            storyId: STORY.id,
            versionNumber: 1,
            titleHu: overrides.previousVersion.titleHu,
            leadHu: overrides.previousVersion.leadHu,
            bodyHu: overrides.previousVersion.bodyHu,
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
            isPublished: true,
            qualityIssues: null,
            createdAt: new Date(),
          }
        : null;

  return {
    storyRepository: { getById: vi.fn(async () => STORY) },
    storyVersionRepository: {
      getLatest: vi.fn(async () => previousVersion),
      createNextVersion: vi.fn(
        async (storyId: string, input: NewStoryVersionInput): Promise<StoryVersion> => {
          createNextVersionCalls.push({ storyId, ...input });
          return {
            id: "new-version",
            storyId,
            versionNumber: (previousVersion?.versionNumber ?? 0) + 1,
            titleHu: input.titleHu,
            leadHu: input.leadHu,
            bodyHu: input.bodyHu,
            metaDescription: null,
            seoTags: null,
            structuredData: null,
            changeSummaryHu: input.changeSummaryHu,
            generatedByModel: input.generatedByModel,
            isAiGenerated: input.isAiGenerated,
            promptVersion: input.promptVersion,
            factConsistencyScore: String(input.factConsistencyScore),
            selfCheckFallback: input.selfCheckFallback,
            editorialRewriteApplied: false,
            isPublished: false,
            qualityIssues: input.qualityIssues ?? null,
            createdAt: new Date(),
          };
        },
      ),
    },
    factRepository: { listByStoryId: vi.fn(async () => [FACT]) },
    editorialKnowledgeRepository: {
      findRelevant: vi.fn(async () => overrides?.knowledge ?? []),
    },
    llm,
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
    createNextVersionCalls,
  };
}

function triggerEvent() {
  return {
    ...createEventEnvelope({ correlationId: "66666666-6666-4666-8666-666666666666" }),
    type: "story/facts.verified" as const,
    payload: {
      story_id: STORY.id,
      confidence_score: 0.7,
      risk_level: "low" as const,
      has_contradiction: false,
      prompt_injection_suspected: false,
    },
  };
}

function queueGeneration(
  llm: FakeLlmClient,
  overrides?: Partial<{
    title_hu: string;
    lead_hu: string;
    body_hu: string;
    change_summary_hu: string | null;
  }>,
) {
  llm.queueJson({
    data: {
      title_hu: "A Liverpool megnyerte a rangadót",
      lead_hu:
        "A Liverpool fegyelmezett játékkal és pontos befejezésekkel győzött a fontos bajnoki mérkőzésen.",
      body_hu:
        "A Liverpool már az első félidőben kezdeményezően futballozott, majd a szünet után is megőrizte a mérkőzés feletti irányítást. A csapat szervezetten védekezett, és a kialakított helyzeteit eredményesen használta ki.",
      change_summary_hu: null,
      ...overrides,
    },
    inputTokens: 10,
    outputTokens: 10,
  });
}

function queueSelfCheck(
  llm: FakeLlmClient,
  consistent: boolean,
  score: number,
  isFallback?: boolean,
  issues: string[] = consistent ? [] : ["hiba"],
) {
  llm.queueJson({
    data: { consistent, fact_consistency_score: score, issues },
    inputTokens: 5,
    outputTokens: 5,
    isFallback,
  });
}

describe("handleStoryFactsVerified", () => {
  it("creates the first StoryVersion with a null change summary when the self-check passes", async () => {
    const deps = buildDeps();
    queueGeneration(deps.llm);
    queueSelfCheck(deps.llm, true, 0.95);

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.createNextVersionCalls).toEqual([
      expect.objectContaining({
        storyId: STORY.id,
        changeSummaryHu: null,
        factConsistencyScore: 0.95,
      }),
    ]);
    expect(deps.emitted).toEqual([
      expect.objectContaining({
        type: "story/content.drafted",
        payload: {
          story_id: STORY.id,
          story_version_id: "new-version",
          fact_consistency_score: 0.95,
        },
      }),
    ]);
    expect(deps.llm.jsonRequests).toHaveLength(2);
  });

  it("falls back to a default change summary when updating and the model omits one", async () => {
    const deps = buildDeps({
      previousVersion: { titleHu: "Régi cím", leadHu: "Régi lead", bodyHu: "Régi törzs" },
    });
    queueGeneration(deps.llm, { change_summary_hu: null });
    queueSelfCheck(deps.llm, true, 1);

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.createNextVersionCalls[0]).toMatchObject({
      changeSummaryHu: "Frissítés az új információk alapján.",
    });
  });

  it("repairs one inconsistent draft and persists it when the second self-check passes", async () => {
    const deps = buildDeps();
    queueGeneration(deps.llm, { title_hu: "Rossz cím" });
    queueSelfCheck(deps.llm, false, 0.2, false, ["Nem igazolt állítás"]);
    queueGeneration(deps.llm, { title_hu: "Javított cím" });
    queueSelfCheck(deps.llm, true, 1);

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.llm.jsonRequests).toHaveLength(4);
    expect(deps.llm.jsonRequests[2]?.messages[0]?.content).toContain("Nem igazolt állítás");
    expect(deps.createNextVersionCalls[0]).toMatchObject({
      titleHu: "Javított cím",
      factConsistencyScore: 1,
    });
  });

  it("fails closed after the single fact repair also fails self-check", async () => {
    const deps = buildDeps();
    queueGeneration(deps.llm, { title_hu: "Rossz cím" });
    queueSelfCheck(deps.llm, false, 0.2);
    queueGeneration(deps.llm, { title_hu: "Még mindig hibás cím" });
    queueSelfCheck(deps.llm, false, 0.4);

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.llm.jsonRequests).toHaveLength(4);
    expect(deps.createNextVersionCalls[0]).toMatchObject({
      titleHu: "Még mindig hibás cím",
      factConsistencyScore: 0.4,
    });
  });

  it("does not repair an inconsistent fallback generation", async () => {
    const deps = buildDeps();
    deps.llm.queueJson({
      data: { title_hu: "Fallback", lead_hu: "Lead", body_hu: "Törzs", change_summary_hu: null },
      inputTokens: 0,
      outputTokens: 0,
      isFallback: true,
    });
    queueSelfCheck(deps.llm, false, 0.2);

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.llm.jsonRequests).toHaveLength(2);
    expect(deps.createNextVersionCalls[0]).toMatchObject({ factConsistencyScore: 0.2 });
  });

  it("labels the version as not-AI-generated when deps.llm is the NoLlmClient adapter", async () => {
    const deps = buildDeps();
    deps.llm = new NoLlmClient() as unknown as FakeLlmClient;

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.createNextVersionCalls).toEqual([
      expect.objectContaining({
        generatedByModel: NO_LLM_MODEL_LABEL,
        isAiGenerated: false,
      }),
    ]);
    // no-LLM self-check is always consistent -> exactly one generation attempt, no retry.
    expect(deps.createNextVersionCalls).toHaveLength(1);
  });

  it("labels the version as not-AI-generated when a wrapping client (e.g. ProviderFallbackLlmClient) served this content from its own fallback branch", async () => {
    // Regression test: deps.llm is NOT literally a NoLlmClient instance here
    // (it's a FakeLlmClient, simulating a wrapper like ProviderFallbackLlmClient
    // or BudgetGuardedLlmClient), so `deps.llm instanceof NoLlmClient` alone
    // would incorrectly say isAiGenerated=true even though the actual content
    // came from a fallback (see client.ts's `LlmUsage.isFallback`).
    const deps = buildDeps();
    deps.llm.queueJson({
      data: { title_hu: "Cím", lead_hu: "Lead", body_hu: "Törzs", change_summary_hu: null },
      inputTokens: 0,
      outputTokens: 0,
      isFallback: true,
    });
    queueSelfCheck(deps.llm, true, 1);

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.createNextVersionCalls).toEqual([
      expect.objectContaining({
        generatedByModel: NO_LLM_MODEL_LABEL,
        isAiGenerated: false,
      }),
    ]);
  });

  it("still labels real AI-generated content as isAiGenerated:true even when the self-check step itself falls back", async () => {
    // Regression test for the reported labeling bug: generation succeeds via
    // a real provider call, but the *separate* self-check validation call
    // falls back to No-LLM (e.g. a transient provider error on just that
    // call). The actual title/lead/body still came from real AI — only the
    // self-check's own isFallback must never flip that.
    const deps = buildDeps();
    queueGeneration(deps.llm, { title_hu: "Valódi cím" });
    queueSelfCheck(deps.llm, true, 1, true);

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.createNextVersionCalls).toEqual([
      expect.objectContaining({
        titleHu: "Valódi cím",
        generatedByModel: MODEL_TIERS.writing,
        isAiGenerated: true,
      }),
    ]);
  });

  it("attempts one targeted fix-up call when the Content Quality Gate flags the first draft, and clears qualityIssues once the fix succeeds", async () => {
    const deps = buildDeps();
    const englishTitle = "England beat France in a ten goal thriller for third place";
    queueGeneration(deps.llm, { title_hu: englishTitle });
    queueSelfCheck(deps.llm, true, 1);
    // The fix-up call (targeted regeneration)
    queueGeneration(deps.llm, {
      title_hu: "Anglia nyerte a harmadik helyet egy tíz gólos csatában",
    });
    queueSelfCheck(deps.llm, true, 1);

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.llm.jsonRequests).toHaveLength(4);
    expect(deps.createNextVersionCalls).toEqual([
      expect.objectContaining({
        titleHu: "Anglia nyerte a harmadik helyet egy tíz gólos csatában",
        isAiGenerated: true,
        qualityIssues: [],
      }),
    ]);
  });

  it("keeps isAiGenerated:true but records qualityIssues when the fix-up attempt still fails", async () => {
    const deps = buildDeps();
    const englishTitle = "England beat France in a ten goal thriller for third place";
    queueGeneration(deps.llm, { title_hu: englishTitle });
    queueSelfCheck(deps.llm, true, 1);
    // The fix-up call still returns English — quality gate fails again.
    queueGeneration(deps.llm, { title_hu: englishTitle });
    queueSelfCheck(deps.llm, true, 1);

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.llm.jsonRequests).toHaveLength(4);
    expect(deps.createNextVersionCalls).toEqual([
      expect.objectContaining({
        titleHu: englishTitle,
        isAiGenerated: true,
        qualityIssues: [{ field: "title", kind: "looks_english" }],
      }),
    ]);
  });

  it("never attempts a quality fix-up for a No-LLM passthrough (nothing real to fix)", async () => {
    const deps = buildDeps();
    deps.llm = new NoLlmClient() as unknown as FakeLlmClient;

    await handleStoryFactsVerified(deps, triggerEvent());

    // Only the original generation dispatch happened — no extra fix-up call.
    expect(deps.createNextVersionCalls).toHaveLength(1);
  });

  it("throws when the Story cannot be found", async () => {
    const deps = buildDeps();
    deps.storyRepository.getById = vi.fn(async () => null);

    await expect(handleStoryFactsVerified(deps, triggerEvent())).rejects.toThrow("not found");
  });

  it("passes relevant active V2 knowledge to the Writer without a legacy correction dependency", async () => {
    const deps = buildDeps({ knowledge: [V2_KNOWLEDGE] });
    deps.factRepository.listByStoryId = vi.fn(async () => [
      {
        ...FACT,
        factType: "quote" as const,
        payload: {
          detail_hu: "",
          quote_original: "He is a real super-sub for this team.",
          quote_speaker: "Manager",
        },
      },
    ]);
    queueGeneration(deps.llm);
    queueSelfCheck(deps.llm, true, 1);

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.llm.jsonRequests[0]?.system).toContain("football.mwe.super-sub");
    expect(deps.editorialKnowledgeRepository.findRelevant).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, contexts: expect.arrayContaining(["quote"]) }),
    );
  });
});
