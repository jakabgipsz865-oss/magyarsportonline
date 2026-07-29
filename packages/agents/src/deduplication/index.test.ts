import type { Entity } from "@magyarsportonline/db";
import { createEventEnvelope } from "@magyarsportonline/events";
import { createLogger } from "@magyarsportonline/observability";
import { describe, expect, it, vi } from "vitest";
import { handleSourceArticleIngested, type DeduplicationDeps } from "./index";

const RAW_ARTICLE = {
  id: "22222222-2222-4222-8222-222222222222",
  sourceId: "source-1",
  sourceUrl: "https://www.bbc.co.uk/sport/football/articles/liverpool-arsenal",
  titleOriginal: "Liverpool beat Arsenal 3-1",
  subtitleOriginal: null,
  bodyOriginal: "A dramatic match at Anfield.",
  contentOrigin: "full_article",
  authorOriginal: null,
  language: "en",
  embedding: null,
  extractedEntities: null,
  ingestStatus: "ingested" as const,
  storyId: null,
  publishedAtSource: new Date("2026-07-27T20:00:00.000Z"),
  ingestedAt: new Date("2026-07-27T20:05:00.000Z"),
  imageUrl: null,
};

const LIVERPOOL_ENTITY = {
  id: "entity-liverpool",
  type: "team" as const,
  nameCanonical: "Liverpool FC",
  nameHu: "Liverpool",
  aliases: ["Liverpool"],
  externalRef: null,
};

const ARSENAL_ENTITY = {
  id: "entity-arsenal",
  type: "team" as const,
  nameCanonical: "Arsenal FC",
  nameHu: "Arsenal",
  aliases: ["Arsenal"],
  externalRef: null,
};

function buildDeps(overrides?: {
  entities?: Entity[];
  candidates?: Awaited<
    ReturnType<DeduplicationDeps["storyMatchRepository"]["findCandidateStories"]>
  >;
}): DeduplicationDeps & { emitted: unknown[]; recordedDecisions: unknown[] } {
  const emitted: unknown[] = [];
  const recordedDecisions: unknown[] = [];
  return {
    rawArticleRepository: { getById: vi.fn(async () => RAW_ARTICLE) },
    entityRepository: {
      listAll: vi.fn(async () => overrides?.entities ?? [LIVERPOOL_ENTITY, ARSENAL_ENTITY]),
    },
    storyMatchRepository: {
      findCandidateStories: vi.fn(async () => overrides?.candidates ?? []),
      recordDecision: vi.fn(async (decision: unknown) => {
        recordedDecisions.push(decision);
        return "decision-id";
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
    defaultCategorySlug: "labdarugas",
    emitted,
    recordedDecisions,
  };
}

function ingestedEvent() {
  return {
    ...createEventEnvelope({ correlationId: "33333333-3333-4333-8333-333333333333" }),
    type: "source/article.ingested" as const,
    payload: { raw_article_id: RAW_ARTICLE.id, source_id: RAW_ARTICLE.sourceId },
  };
}

describe("handleSourceArticleIngested", () => {
  it("emits story/candidate.identified with match_type NEW_STORY when no candidate shares a specific entity", async () => {
    const deps = buildDeps();

    await handleSourceArticleIngested(deps, ingestedEvent());

    expect(deps.emitted).toHaveLength(1);
    const [event] = deps.emitted as Array<{
      type: string;
      payload: { raw_article_id: string; match_type: string; fingerprint_hash: string };
    }>;
    expect(event?.type).toBe("story/candidate.identified");
    expect(event?.payload.match_type).toBe("NEW_STORY");
    expect(event?.payload.raw_article_id).toBe(RAW_ARTICLE.id);
    expect(event?.payload.fingerprint_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records a story_match_decisions row for every decision, including auto_new_story", async () => {
    const deps = buildDeps();

    await handleSourceArticleIngested(deps, ingestedEvent());

    expect(deps.recordedDecisions).toEqual([
      expect.objectContaining({
        rawArticleId: RAW_ARTICLE.id,
        decision: "auto_new_story",
        candidateStoryId: null,
        resultingStoryId: null,
      }),
    ]);
  });

  it("emits MATCH with story_id when a candidate has strong same-match identity", async () => {
    const deps = buildDeps({
      candidates: [
        {
          storyId: "story-existing",
          canonicalTitle: "Liverpool beat Arsenal 3-1",
          lastUpdatedAt: new Date("2026-07-27T18:00:00.000Z"),
          entities: [
            {
              entityId: "entity-liverpool",
              type: "team",
              nameCanonical: "Liverpool FC",
              role: "subject",
            },
            {
              entityId: "entity-arsenal",
              type: "team",
              nameCanonical: "Arsenal FC",
              role: "opponent",
            },
          ],
          rawArticleSourceUrls: ["https://www.skysports.com/football/news/1"],
        },
      ],
    });

    await handleSourceArticleIngested(deps, ingestedEvent());

    const [event] = deps.emitted as Array<{
      type: string;
      payload: { match_type: string; story_id?: string };
    }>;
    expect(event?.payload.match_type).toBe("MATCH");
    expect(event?.payload.story_id).toBe("story-existing");
    expect(deps.recordedDecisions).toEqual([
      expect.objectContaining({
        decision: "auto_merge",
        candidateStoryId: "story-existing",
        resultingStoryId: "story-existing",
      }),
    ]);
  });

  it("never auto-merges on a generic (competition-only) shared entity — emits NEW_STORY, not MATCH", async () => {
    const competitionEntity = {
      id: "entity-premier-league",
      type: "competition" as const,
      nameCanonical: "Premier League",
      nameHu: "Premier League",
      aliases: [],
      externalRef: null,
    };
    const deps = buildDeps({ entities: [competitionEntity] });

    await handleSourceArticleIngested(deps, ingestedEvent());

    const [event] = deps.emitted as Array<{ payload: { match_type: string } }>;
    // No specific (team/player) entity in the title/lead -> no candidate
    // lookup even happens, so this can only ever be NEW_STORY.
    expect(event?.payload.match_type).toBe("NEW_STORY");
  });

  it("emits AMBIGUOUS with a candidates list when a specific entity is shared but corroboration is too weak to auto-merge", async () => {
    const deps = buildDeps({
      candidates: [
        {
          storyId: "story-weak-candidate",
          canonicalTitle: "Liverpool linked with a move",
          // A different day bucket AND no generic corroboration -> score 50, below the 65 auto-merge threshold.
          lastUpdatedAt: new Date("2026-07-20T18:00:00.000Z"),
          entities: [
            {
              entityId: "entity-liverpool",
              type: "team",
              nameCanonical: "Liverpool FC",
              role: "subject",
            },
          ],
          rawArticleSourceUrls: ["https://www.skysports.com/football/news/2"],
        },
      ],
    });

    await handleSourceArticleIngested(deps, ingestedEvent());

    const [event] = deps.emitted as Array<{
      payload: { match_type: string; candidates?: Array<{ story_id: string; score: number }> };
    }>;
    expect(event?.payload.match_type).toBe("AMBIGUOUS");
    expect(event?.payload.candidates).toEqual([{ story_id: "story-weak-candidate", score: 0.5 }]);
    expect(deps.recordedDecisions).toEqual([
      expect.objectContaining({
        decision: "needs_review",
        candidateStoryId: "story-weak-candidate",
        resultingStoryId: null,
        reviewStatus: "pending",
      }),
    ]);
  });

  it("throws when the RawArticle cannot be found", async () => {
    const deps = buildDeps();
    deps.rawArticleRepository.getById = vi.fn(async () => null);

    await expect(handleSourceArticleIngested(deps, ingestedEvent())).rejects.toThrow("not found");
  });
});
