import { createEventEnvelope } from "@magyarsportonline/events";
import { createLogger } from "@magyarsportonline/observability";
import { describe, expect, it, vi } from "vitest";
import { handleStoryPublished, type ReadModelProjectorDeps } from "./index";

const STORY = {
  id: "story-1",
  slug: "liverpool-nyert",
  canonicalTitle: "Liverpool vs Arsenal",
  status: "published" as const,
  riskLevel: "low" as const,
  confidenceScore: "0.700",
  categoryId: null,
  currentVersionId: "v1",
  versionCount: 1,
  firstSeenAt: new Date(),
  lastUpdatedAt: new Date(),
  publishedAt: new Date("2026-07-27T21:00:00.000Z"),
  isDeveloping: false,
};

function version(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "v1",
    storyId: STORY.id,
    versionNumber: 1,
    titleHu: "Liverpool nyert",
    leadHu: "Lead szöveg.",
    bodyHu: "Törzs szöveg.\n\nMásodik bekezdés.",
    metaDescription: null,
    seoTags: null,
    structuredData: null,
    changeSummaryHu: null,
    generatedByModel: "claude-sonnet-5",
    isAiGenerated: true,
    promptVersion: "hungarian-writer@0.1.0",
    factConsistencyScore: "1.000",
    isPublished: true,
    qualityIssues: null,
    createdAt: new Date("2026-07-27T20:55:00.000Z"),
    ...overrides,
  };
}

function buildDeps(overrides?: {
  versions?: ReturnType<typeof version>[];
}): ReadModelProjectorDeps & { upserts: unknown[] } {
  const upserts: unknown[] = [];
  return {
    storyRepository: { getById: vi.fn(async () => STORY) },
    storyVersionRepository: {
      listByStoryId: vi.fn(async () => overrides?.versions ?? [version()]),
    },
    storySourceRepository: {
      summaryByStoryId: vi.fn(async () => [
        {
          name: "BBC Sport - Football",
          url: "https://example.com/1",
          firstSeenAt: "2026-07-27T20:00:00.000Z",
        },
      ]),
    },
    storyReadModelRepository: {
      upsert: vi.fn(async (row: unknown) => {
        upserts.push(row);
      }),
    },
    logger: createLogger({
      destination: { write: () => true } as unknown as NodeJS.WritableStream,
    }),
    upserts,
  };
}

function publishedEvent() {
  return {
    ...createEventEnvelope({ correlationId: "99999999-9999-4999-8999-999999999999" }),
    type: "story/published" as const,
    payload: { story_id: STORY.id, story_version_id: "v1" },
  };
}

describe("handleStoryPublished", () => {
  it("projects the published version into story_read_model", async () => {
    const deps = buildDeps();

    await handleStoryPublished(deps, publishedEvent());

    expect(deps.upserts).toEqual([
      expect.objectContaining({
        storyId: STORY.id,
        slug: STORY.slug,
        titleHu: "Liverpool nyert",
        leadHu: "Lead szöveg.",
        bodyHtml: "<p>Törzs szöveg.</p>\n<p>Második bekezdés.</p>",
        isAiGenerated: true,
        confidenceScore: STORY.confidenceScore,
        isDeveloping: false,
        sourcesSummary: [expect.objectContaining({ name: "BBC Sport - Football" })],
        versionHistorySummary: [
          {
            version_number: 1,
            created_at: version().createdAt.toISOString(),
            change_summary: null,
          },
        ],
      }),
    ]);
  });

  it("throws when the Story has no slug", async () => {
    const deps = buildDeps();
    deps.storyRepository.getById = vi.fn(async () => ({ ...STORY, slug: null }));

    await expect(handleStoryPublished(deps, publishedEvent())).rejects.toThrow("no slug");
  });

  it("throws when no published version can be found", async () => {
    const deps = buildDeps({ versions: [] });

    await expect(handleStoryPublished(deps, publishedEvent())).rejects.toThrow(
      "No published StoryVersion",
    );
  });
});
