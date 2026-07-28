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
};

function rawArticle(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "raw-1",
    sourceId: "source-1",
    sourceUrl: "https://example.com/1",
    titleOriginal: "Liverpool win 3-1",
    bodyOriginal: "A dominant display.",
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
    ...overrides,
  };
}

function buildDeps(): FactVerificationDeps & {
  emitted: unknown[];
  updateCalls: unknown[];
  llm: FakeLlmClient;
} {
  const emitted: unknown[] = [];
  const updateCalls: unknown[] = [];
  const llm = new FakeLlmClient();
  let nextFactId = 1;

  return {
    storyRepository: {
      getById: vi.fn(async () => STORY),
      updateFactVerificationResult: vi.fn(async (storyId: string, result: unknown) => {
        updateCalls.push({ storyId, ...(result as Record<string, unknown>) });
      }),
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
      insertMany: vi.fn(
        async (
          rows: Array<{
            storyId: string;
            rawArticleId: string;
            factType: Fact["factType"];
            payload: unknown;
          }>,
        ): Promise<Fact[]> =>
          rows.map((row) => ({
            id: `fact-${nextFactId++}`,
            corroborationCount: 1,
            isContradicted: false,
            extractedAt: new Date(),
            ...row,
          })),
      ),
      markContradicted: vi.fn(async () => undefined),
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
          { fact_type: "score", detail_hu: "3-1", quote_original: null, quote_speaker: null },
        ],
      },
      inputTokens: 10,
      outputTokens: 5,
    });
    deps.llm.queueJson({
      data: {
        facts: [
          { fact_type: "score", detail_hu: "3-1", quote_original: null, quote_speaker: null },
        ],
      },
      inputTokens: 10,
      outputTokens: 5,
    });

    await handleFactVerificationTrigger(deps, triggerEvent());

    expect(deps.llm.jsonRequests).toHaveLength(2);
    expect(deps.factRepository.insertMany).toHaveBeenCalledTimes(1);
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
          { fact_type: "score", detail_hu: "3-1", quote_original: null, quote_speaker: null },
        ],
      },
      inputTokens: 10,
      outputTokens: 5,
    });
    deps.llm.queueJson({
      data: {
        facts: [
          { fact_type: "score", detail_hu: "2-1", quote_original: null, quote_speaker: null },
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

  it("throws when the Story cannot be found", async () => {
    const deps = buildDeps();
    deps.storyRepository.getById = vi.fn(async () => null);

    await expect(handleFactVerificationTrigger(deps, triggerEvent())).rejects.toThrow("not found");
  });
});
