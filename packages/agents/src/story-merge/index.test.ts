import { createEventEnvelope } from "@magyarsportonline/events";
import { createLogger } from "@magyarsportonline/observability";
import { describe, expect, it, vi } from "vitest";
import { handleStoryCandidateIdentified, type StoryMergeDeps } from "./index";

const RAW_ARTICLE = {
  id: "raw-1",
  sourceId: "source-1",
  sourceUrl: "https://example.com/1",
  titleOriginal: "Liverpool beat Arsenal 3-1",
  subtitleOriginal: null,
  bodyOriginal: "body",
  authorOriginal: null,
  language: "en",
  embedding: null,
  extractedEntities: null,
  ingestStatus: "ingested" as const,
  storyId: null,
  publishedAtSource: null,
  ingestedAt: new Date(),
  imageUrl: null,
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

function buildDeps(
  created: boolean,
): StoryMergeDeps & { emitted: unknown[]; links: unknown[]; resultingStorySets: unknown[] } {
  const emitted: unknown[] = [];
  const links: unknown[] = [];
  const resultingStorySets: unknown[] = [];
  return {
    storyRepository: {
      createOrMatchByFingerprint: vi.fn(async () => ({ story: STORY, created })),
      insertNew: vi.fn(async () => STORY),
      lockAndGetById: vi.fn(async () => STORY),
      setImageUrlIfMissing: vi.fn(async () => undefined),
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
    storyMatchRepository: {
      setResultingStory: vi.fn(async (rawArticleId: string, resultingStoryId: string) => {
        resultingStorySets.push({ rawArticleId, resultingStoryId });
      }),
    },
    entityRepository: {
      listAll: vi.fn(async () => []),
      linkToStory: vi.fn(async () => undefined),
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
    resultingStorySets,
  };
}

function newStoryEvent() {
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

function matchEvent(storyId: string) {
  return {
    ...createEventEnvelope({ correlationId: "44444444-4444-4444-8444-444444444444" }),
    type: "story/candidate.identified" as const,
    payload: {
      raw_article_id: RAW_ARTICLE.id,
      match_type: "MATCH" as const,
      story_id: storyId,
      fingerprint_hash: "abc123",
    },
  };
}

function ambiguousEvent(candidateStoryId: string) {
  return {
    ...createEventEnvelope({ correlationId: "44444444-4444-4444-8444-444444444444" }),
    type: "story/candidate.identified" as const,
    payload: {
      raw_article_id: RAW_ARTICLE.id,
      match_type: "AMBIGUOUS" as const,
      candidates: [{ story_id: candidateStoryId, score: 0.5 }],
      fingerprint_hash: "abc123",
    },
  };
}

describe("handleStoryCandidateIdentified", () => {
  describe("match_type NEW_STORY", () => {
    it("emits story/created and links as initial when the fingerprint is new", async () => {
      const deps = buildDeps(true);

      await handleStoryCandidateIdentified(deps, newStoryEvent());

      expect(deps.links).toEqual([
        { storyId: STORY.id, rawArticleId: RAW_ARTICLE.id, contributionType: "initial" },
      ]);
      expect(deps.emitted).toEqual([
        expect.objectContaining({
          type: "story/created",
          payload: { story_id: STORY.id },
        }),
      ]);
      expect(deps.resultingStorySets).toEqual([
        { rawArticleId: RAW_ARTICLE.id, resultingStoryId: STORY.id },
      ]);
    });

    it("emits story/merge.completed(new_info) on a fingerprint collision between two NEW_STORY decisions", async () => {
      const deps = buildDeps(false);

      await handleStoryCandidateIdentified(deps, newStoryEvent());

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

      await expect(handleStoryCandidateIdentified(deps, newStoryEvent())).rejects.toThrow(
        "not found",
      );
    });
  });

  describe("match_type MATCH", () => {
    it("locks the resolved story by id, links as new_info, and emits story/merge.completed", async () => {
      const deps = buildDeps(true);

      await handleStoryCandidateIdentified(deps, matchEvent(STORY.id));

      expect(deps.storyRepository.lockAndGetById).toHaveBeenCalledWith(STORY.id);
      expect(deps.storyRepository.createOrMatchByFingerprint).not.toHaveBeenCalled();
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

    it("backfills the Story's imageUrl when the raw article has one", async () => {
      const deps = buildDeps(true);
      deps.rawArticleRepository.getById = vi.fn(async () => ({
        ...RAW_ARTICLE,
        imageUrl: "https://example.com/photo.jpg",
      }));

      await handleStoryCandidateIdentified(deps, matchEvent(STORY.id));

      expect(deps.storyRepository.setImageUrlIfMissing).toHaveBeenCalledWith(
        STORY.id,
        "https://example.com/photo.jpg",
      );
    });

    it("throws when story_id is missing from a MATCH event", async () => {
      const deps = buildDeps(true);
      const event = matchEvent(STORY.id);
      // @ts-expect-error deliberately malformed for the test
      delete event.payload.story_id;

      await expect(handleStoryCandidateIdentified(deps, event)).rejects.toThrow("story_id");
    });
  });

  describe("match_type AMBIGUOUS", () => {
    it("creates its OWN new Story (never merges into the flagged candidate) and records resultingStoryId", async () => {
      const deps = buildDeps(true);

      await handleStoryCandidateIdentified(deps, ambiguousEvent("story-candidate-not-merged-into"));

      expect(deps.storyRepository.insertNew).toHaveBeenCalledTimes(1);
      expect(deps.storyRepository.createOrMatchByFingerprint).not.toHaveBeenCalled();
      expect(deps.storyRepository.lockAndGetById).not.toHaveBeenCalled();
      expect(deps.links).toEqual([
        { storyId: STORY.id, rawArticleId: RAW_ARTICLE.id, contributionType: "initial" },
      ]);
      expect(deps.emitted).toEqual([
        expect.objectContaining({ type: "story/created", payload: { story_id: STORY.id } }),
      ]);
      expect(deps.resultingStorySets).toEqual([
        { rawArticleId: RAW_ARTICLE.id, resultingStoryId: STORY.id },
      ]);
    });
  });
});
