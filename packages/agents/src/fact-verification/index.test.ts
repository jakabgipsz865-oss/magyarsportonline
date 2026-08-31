import type { Fact } from "@magyarsportonline/db";
import { createEventEnvelope } from "@magyarsportonline/events";
import { FakeLlmClient } from "@magyarsportonline/llm";
import { createLogger } from "@magyarsportonline/observability";
import { describe, expect, it, vi } from "vitest";
import { handleFactVerificationTrigger, type FactVerificationDeps } from "./index";

const STORY = {
  id: "story-1",
  slug: null,
  canonicalTitle: "Liverpool vs Arsenal",
  status: "draft" as const,
  riskLevel: null,
  confidenceScore: "0.300",
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

function rawArticle(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "raw-1",
    sourceId: "source-1",
    sourceUrl: "https://example.com/1",
    titleOriginal: "Liverpool win 3-1",
    subtitleOriginal: null,
    bodyOriginal: "A dominant display.",
    contentOrigin: "full_article",
    authorOriginal: null,
    language: "en",
    embedding: null,
    extractedEntities: null,
    ingestStatus: "merged" as const,
    storyId: STORY.id,
    publishedAtSource: null,
    ingestedAt: new Date("2026-07-27T20:00:00.000Z"),
    imageUrl: null,
    ...overrides,
  };
}

function source(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "source-1",
    name: "Source",
    baseUrl: "https://example.com",
    type: "rss" as const,
    language: "en",
    licenseType: "public_rss" as const,
    reliabilityTier: "B" as const,
    fetchConfig: {},
    isActive: true,
    onboardedAt: new Date(),
    lastFetchedAt: null,
    lastFetchStatus: null,
    country: null,
    leagueTags: null,
    category: null,
    contentMode: null,
    trustBaseline: null,
    robotsStatus: null,
    termsStatus: null,
    attributionRule: null,
    imagePolicy: null,
    pollingFrequencyMinutes: null,
    extractorName: null,
    lastSuccessAt: null,
    ingestWatermarkAt: null,
    lastErrorAt: null,
    ...overrides,
  };
}

const SOURCE_METAS = [
  {
    storyId: STORY.id,
    rawArticleId: "raw-1",
    sourceId: "source-1",
    sourceName: "Source",
    category: null,
    reliabilityTier: "B" as const,
    contributionType: "initial" as const,
    excluded: false,
    excludedReason: null,
  },
  {
    storyId: STORY.id,
    rawArticleId: "raw-2",
    sourceId: "source-2",
    sourceName: "Source",
    category: null,
    reliabilityTier: "A" as const,
    contributionType: "new_info" as const,
    excluded: false,
    excludedReason: null,
  },
];

function buildDeps(): FactVerificationDeps & {
  emitted: unknown[];
  updateCalls: unknown[];
  llm: FakeLlmClient;
} {
  const emitted: unknown[] = [];
  const updateCalls: unknown[] = [];
  const llm = new FakeLlmClient();
  let nextFactId = 1;
  const factsStore: Fact[] = [];

  return {
    storyRepository: {
      getById: vi.fn(async () => STORY),
      updateFactVerificationResult: vi.fn(async (storyId: string, result: unknown) => {
        updateCalls.push({ storyId, ...(result as Record<string, unknown>) });
      }),
      updateCredibilityResult: vi.fn(async () => undefined),
    },
    rawArticleRepository: {
      listByStoryId: vi.fn(async () => [
        rawArticle({ id: "raw-1", sourceId: "source-1" }),
        rawArticle({
          id: "raw-2",
          sourceId: "source-2",
          ingestedAt: new Date("2026-07-27T20:05:00.000Z"),
        }),
      ]),
    },
    sourceRepository: {
      getById: vi.fn(async (id: string) =>
        id === "source-2" ? source({ id: "source-2", reliabilityTier: "A" }) : source({}),
      ),
    },
    factRepository: {
      replaceForStory: vi.fn(
        async (
          _storyId: string,
          rows: Array<{
            storyId: string;
            rawArticleId: string;
            factType: Fact["factType"];
            payload: unknown;
          }>,
        ): Promise<Fact[]> => {
          const inserted = rows.map((row) => ({
            id: `fact-${nextFactId++}`,
            corroborationCount: 1,
            isContradicted: false,
            excluded: false,
            excludedReason: null,
            extractedAt: new Date(),
            ...row,
          }));
          factsStore.push(...inserted);
          return inserted;
        },
      ),
      markContradicted: vi.fn(async (factId: string) => {
        const fact = factsStore.find((f) => f.id === factId);
        if (fact) fact.isContradicted = true;
      }),
      bumpCorroboration: vi.fn(async (factId: string, count: number) => {
        const fact = factsStore.find((f) => f.id === factId);
        if (fact) fact.corroborationCount = count;
      }),
      listByStoryId: vi.fn(async (storyId: string) =>
        factsStore.filter((fact) => fact.storyId === storyId),
      ),
      listByStoryIdWithSourceName: vi.fn(async (storyId: string) => {
        const metaByRawArticleId = new Map(
          SOURCE_METAS.map((meta) => [meta.rawArticleId, meta] as const),
        );
        return factsStore
          .filter((fact) => fact.storyId === storyId && !fact.excluded)
          .flatMap((fact) => {
            const meta = metaByRawArticleId.get(fact.rawArticleId);
            if (!meta || meta.excluded) return [];
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
      sourcesWithMetaByStoryId: vi.fn(async () => SOURCE_METAS),
    },
    storyCredibilityHistoryRepository: {
      insert: vi.fn(
        async (row: {
          storyId: string;
          score: number;
          band: string;
          labelHu: string;
          justificationHu: string;
          officialConfirmed: boolean;
          corroboratingSourceCount: number;
          source?: string;
          explanation?: unknown;
        }) => ({
          id: "history-1",
          recordedAt: new Date(),
          source: "auto",
          explanation: null,
          ...row,
        }),
      ),
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
    updateCalls,
  };
}

function triggerEvent() {
  return {
    ...createEventEnvelope({ correlationId: "55555555-5555-4555-8555-555555555555" }),
    type: "story/created" as const,
    payload: { story_id: STORY.id },
  };
}

describe("handleFactVerificationTrigger", () => {
  it("extracts facts from every linked source, computes confidence, and emits story/facts.verified", async () => {
    const deps = buildDeps();
    deps.llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "score",
            detail_hu: "3-1",
            evidence_original: "Liverpool win 3-1",
            quote_original: null,
            quote_speaker: null,
          },
        ],
      },
      inputTokens: 10,
      outputTokens: 5,
    });
    deps.llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "score",
            detail_hu: "3-1",
            evidence_original: "Liverpool win 3-1",
            quote_original: null,
            quote_speaker: null,
          },
        ],
      },
      inputTokens: 10,
      outputTokens: 5,
    });

    await handleFactVerificationTrigger(deps, triggerEvent());

    expect(deps.llm.jsonRequests).toHaveLength(2);
    expect(deps.factRepository.replaceForStory).toHaveBeenCalledTimes(1);
    expect(deps.factRepository.markContradicted).not.toHaveBeenCalled();

    expect(deps.emitted).toHaveLength(1);
    const [event] = deps.emitted as Array<{
      type: string;
      payload: {
        story_id: string;
        confidence_score: number;
        risk_level: string;
        has_contradiction: boolean;
        prompt_injection_suspected: boolean;
      };
    }>;
    expect(event?.type).toBe("story/facts.verified");
    expect(event?.payload.story_id).toBe(STORY.id);
    expect(event?.payload.has_contradiction).toBe(false);
    expect(event?.payload.risk_level).toBe("low");
    expect(event?.payload.confidence_score).toBeGreaterThan(0);

    expect(deps.updateCalls).toEqual([
      {
        storyId: STORY.id,
        confidenceScore: event?.payload.confidence_score,
        riskLevel: "low",
        isDeveloping: true,
      },
    ]);
  });

  it("marks contradicted score facts and reports has_contradiction", async () => {
    const deps = buildDeps();
    deps.llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "score",
            detail_hu: "3-1",
            evidence_original: "Liverpool win 3-1",
            quote_original: null,
            quote_speaker: null,
          },
        ],
      },
      inputTokens: 10,
      outputTokens: 5,
    });
    deps.llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "score",
            detail_hu: "2-1",
            evidence_original: "A dominant display.",
            quote_original: null,
            quote_speaker: null,
          },
        ],
      },
      inputTokens: 10,
      outputTokens: 5,
    });

    await handleFactVerificationTrigger(deps, triggerEvent());

    expect(deps.factRepository.markContradicted).toHaveBeenCalledTimes(2);
    const [event] = deps.emitted as Array<{ payload: { has_contradiction: boolean } }>;
    expect(event?.payload.has_contradiction).toBe(true);
  });

  it("extracts full articles before older RSS snippets", async () => {
    const deps = buildDeps();
    deps.rawArticleRepository.listByStoryId = vi.fn(async () => [
      rawArticle({
        id: "raw-snippet",
        sourceId: "source-1",
        contentOrigin: "rss_snippet",
        ingestedAt: new Date("2026-07-27T19:00:00.000Z"),
        titleOriginal: "Old snippet",
      }),
      rawArticle({
        id: "raw-full",
        sourceId: "source-2",
        contentOrigin: "full_article",
        ingestedAt: new Date("2026-07-27T20:00:00.000Z"),
        titleOriginal: "Complete source article",
      }),
    ]);
    deps.llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "other",
            detail_hu: "Teljes forrás",
            evidence_original: "Complete source article",
            quote_original: null,
            quote_speaker: null,
          },
        ],
      },
      inputTokens: 10,
      outputTokens: 5,
    });
    deps.llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "other",
            detail_hu: "Rövid kivonat",
            evidence_original: "Old snippet",
            quote_original: null,
            quote_speaker: null,
          },
        ],
      },
      inputTokens: 10,
      outputTokens: 5,
    });

    await handleFactVerificationTrigger(deps, triggerEvent());

    expect(deps.llm.jsonRequests[0]?.messages[0]?.content).toContain("Complete source article");
  });

  it("throws when the Story cannot be found", async () => {
    const deps = buildDeps();
    deps.storyRepository.getById = vi.fn(async () => null);

    await expect(handleFactVerificationTrigger(deps, triggerEvent())).rejects.toThrow("not found");
  });
});
