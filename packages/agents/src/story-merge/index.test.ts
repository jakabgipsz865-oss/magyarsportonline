import { createEventEnvelope } from "@magyarsportonline/events";
import { createLogger } from "@magyarsportonline/observability";
import { describe, expect, it, vi } from "vitest";
import { handleStoryCandidateIdentified, type StoryMergeDeps } from "./index";

const RAW_ARTICLE = {
  id: "raw-1",
  sourceId: "source-1",
  sourceUrl: "https://example.com/1",
  titleOriginal: "Liverpool beat Arsenal 3-1",
  bodyOriginal: "body",
  language: "en",
  embedding: null,
  extractedEntities: null,
  ingestStatus: "ingested" as const,
  storyId: null,
  publishedAtSource: null,
  ingestedAt: new Date(),
};

const STORY = {
  id: "story-1",
  slug: null,
  canonicalTitle: RAW_ARTICLE.titleOriginal,
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
};

function buildDeps(created: boolean): StoryMergeDeps & { emitted: unknown[]; links: unknown[] } {
  const emitted: unknown[] = [];
  const links: unknown[] = [];
  return {
    storyRepository: {
      createOrMatchByFingerprint: vi.fn(async () => ({ story: STORY, created })),
    },
    rawArticleRepository: {
      getById: vi.fn(async () => RAW_ARTICLE),
      linkToStory: vi.fn(async () => undefined),
    },
    storySourceRepository: {
      link: vi.fn(async (storyId: string, rawArticleId: string, contributionType: string) => {
        links.push({ storyId, rawArticleId, contributionType });
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
    links,
  };
}

function candidateEvent() {
  return {
    ...createEventEnvelope({ correlationId: "44444444-4444-4444-8444-444444444444" }),
    type: "story/candidate.identified" as const,
    payload: {
      raw_article_id: RAW_ARTICLE.id,
      match_type: "NEW_STORY" as const,
      fingerprint_hash: "abc123",
    },
  };
}

describe("handleStoryCandidateIdentified", () => {
  it("emits story/created and links as initial when the fingerprint is new", async () => {
    const deps = buildDeps(true);

    await handleStoryCandidateIdentified(deps, candidateEvent());

    expect(deps.links).toEqual([
      { storyId: STORY.id, rawArticleId: RAW_ARTICLE.id, contributionType: "initial" },
    ]);
    expect(deps.emitted).toEqual([
      expect.objectContaining({
        type: "story/created",
        payload: { story_id: STORY.id },
      }),
    ]);
  });

  it("emits story/merge.completed(new_info) and links as new_info on a fingerprint match", async () => {
    const deps = buildDeps(false);

    await handleStoryCandidateIdentified(deps, candidateEvent());

    expect(deps.links).toEqual([
      { storyId: STORY.id, rawArticleId: RAW_ARTICLE.id, contributionType: "new_info" },
    ]);
    expect(deps.emitted).toEqual([
      expect.objectContaining({
        type: "story/merge.completed",
        payload: { story_id: STORY.id, update_type: "new_info" },
      }),
    ]);
  });

  it("throws when the RawArticle cannot be found", async () => {
    const deps = buildDeps(true);
    deps.rawArticleRepository.getById = vi.fn(async () => null);

    await expect(handleStoryCandidateIdentified(deps, candidateEvent())).rejects.toThrow(
      "not found",
    );
  });
});
