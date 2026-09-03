import type { Fact, NewStoryVersionInput, StoryVersion } from "@magyarsportonline/db";
import { createEventEnvelope } from "@magyarsportonline/events";
import { FakeLlmClient, MODEL_TIERS, NO_LLM_MODEL_LABEL } from "@magyarsportonline/llm";
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
  payload: {
    claim_en: "Liverpool beat Arsenal 3-1.",
    evidence_original: "Liverpool beat Arsenal 3-1 at Anfield.",
    subject: "Liverpool",
    predicate: "final_score",
    normalized_value: "3-1",
    event_time_iso: null,
    source_published_at: null,
    quote_original: null,
    quote_speaker: null,
  },
  corroborationCount: 1,
  isContradicted: false,
  excluded: false,
  excludedReason: null,
  extractedAt: new Date(),
};

function buildDeps(facts: Fact[] = [FACT]): HungarianWriterDeps & {
  emitted: unknown[];
  createNextVersionCalls: NewStoryVersionInput[];
  llm: FakeLlmClient;
} {
  const emitted: unknown[] = [];
  const createNextVersionCalls: NewStoryVersionInput[] = [];
  const llm = new FakeLlmClient();
  return {
    storyRepository: { getById: vi.fn(async () => STORY) },
    storyVersionRepository: {
      getLatest: vi.fn(async () => null),
      createNextVersion: vi.fn(async (storyId, input): Promise<StoryVersion> => {
        createNextVersionCalls.push(input);
        return {
          id: "new-version",
          storyId,
          versionNumber: 1,
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
      }),
    },
    factRepository: { listByStoryId: vi.fn(async () => facts) },
    editorialKnowledgeRepository: { findRelevant: vi.fn(async () => []) },
    llm,
    agentRunRepository: { record: vi.fn(async () => undefined) },
    dispatcher: {
      emit: vi.fn(async (event) => {
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

function queueGeneration(
  llm: FakeLlmClient,
  input?: { titleFactIds?: string[]; body?: string; fallback?: boolean },
) {
  llm.queueJson({
    data: {
      title: {
        text: "Liverpool 3-1-re legyőzte az Arsenalt",
        supporting_fact_ids: input?.titleFactIds ?? ["fact-1"],
      },
      lead_sentences: [
        {
          id: "L1",
          text: "A Liverpool 3-1-re nyert az Arsenal ellen.",
          supporting_fact_ids: ["fact-1"],
        },
      ],
      body_paragraphs: [
        {
          sentences: [
            {
              id: "B1",
              text: input?.body ?? "A Liverpool három gólt szerezve győzte le az Arsenalt.",
              supporting_fact_ids: ["fact-1"],
            },
          ],
        },
      ],
      change_summary_hu: null,
    },
    inputTokens: 10,
    outputTokens: 10,
    isFallback: input?.fallback,
  });
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

describe("handleStoryFactsVerified", () => {
  it("uses one Writer call and persists a deterministic 1.0 provenance score", async () => {
    const deps = buildDeps();
    queueGeneration(deps.llm);

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.llm.jsonRequests).toHaveLength(1);
    expect(deps.createNextVersionCalls[0]).toMatchObject({
      factConsistencyScore: 1,
      selfCheckFallback: false,
      generatedByModel: MODEL_TIERS.writing,
      isAiGenerated: true,
    });
    expect(deps.agentRunRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: "hungarian-writer-provenance-validation",
        errorMessage: expect.stringContaining('"sentenceId":"T1"'),
      }),
    );
    expect(deps.emitted).toEqual([
      expect.objectContaining({
        type: "story/content.drafted",
        payload: expect.objectContaining({ fact_consistency_score: 1 }),
      }),
    ]);
  });

  it("fails closed on an unknown Fact ID without a repair call", async () => {
    const deps = buildDeps();
    queueGeneration(deps.llm, { titleFactIds: ["missing-fact"] });

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.llm.jsonRequests).toHaveLength(1);
    expect(deps.createNextVersionCalls[0]?.factConsistencyScore).toBeCloseTo(2 / 3);
    expect(deps.agentRunRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: expect.stringContaining("unknown_fact_id") }),
    );
  });

  it("rejects provenance that cites a contradicted Fact", async () => {
    const deps = buildDeps([{ ...FACT, isContradicted: true }]);
    queueGeneration(deps.llm);

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.createNextVersionCalls[0]?.factConsistencyScore).toBe(0);
    expect(deps.agentRunRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: expect.stringContaining("contradicted_fact_used") }),
    );
  });

  it("records deterministic quality issues without starting a fix loop", async () => {
    const deps = buildDeps();
    queueGeneration(deps.llm, {
      body: "England beat France in a ten goal thriller for third place.",
    });

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.llm.jsonRequests).toHaveLength(1);
    expect(deps.createNextVersionCalls[0]?.qualityIssues).toContainEqual({
      field: "body",
      kind: "looks_english",
    });
  });

  it("keeps fallback-generated content labeled as non-AI", async () => {
    const deps = buildDeps();
    queueGeneration(deps.llm, { fallback: true });

    await handleStoryFactsVerified(deps, triggerEvent());

    expect(deps.createNextVersionCalls[0]).toMatchObject({
      generatedByModel: NO_LLM_MODEL_LABEL,
      isAiGenerated: false,
    });
  });

  it("throws when the Story cannot be found", async () => {
    const deps = buildDeps();
    deps.storyRepository.getById = vi.fn(async () => null);

    await expect(handleStoryFactsVerified(deps, triggerEvent())).rejects.toThrow("not found");
  });
});
