import { createEventEnvelope } from "@magyarsportonline/events";
import { createLogger } from "@magyarsportonline/observability";
import { describe, expect, it, vi } from "vitest";
import { handleSourceArticleIngested, type DeduplicationDeps } from "./index";

const RAW_ARTICLE = {
  id: "22222222-2222-4222-8222-222222222222",
  sourceId: "source-1",
  sourceUrl: "https://example.com/1",
  titleOriginal: "Liverpool beat Arsenal 3-1",
  bodyOriginal: "A dramatic match at Anfield.",
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

function buildDeps(overrides?: {
  entities?: (typeof LIVERPOOL_ENTITY)[];
}): DeduplicationDeps & { emitted: unknown[] } {
  const emitted: unknown[] = [];
  return {
    rawArticleRepository: { getById: vi.fn(async () => RAW_ARTICLE) },
    entityRepository: {
      listAll: vi.fn(async () => overrides?.entities ?? [LIVERPOOL_ENTITY]),
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
  it("emits story/candidate.identified with match_type NEW_STORY and a fingerprint", async () => {
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

  it("produces the same fingerprint for the same category/entity/date-bucket", async () => {
    const depsA = buildDeps();
    const depsB = buildDeps();

    await handleSourceArticleIngested(depsA, ingestedEvent());
    await handleSourceArticleIngested(depsB, ingestedEvent());

    const [eventA] = depsA.emitted as Array<{ payload: { fingerprint_hash: string } }>;
    const [eventB] = depsB.emitted as Array<{ payload: { fingerprint_hash: string } }>;
    expect(eventA?.payload.fingerprint_hash).toBe(eventB?.payload.fingerprint_hash);
  });

  it("still emits a fingerprint when no entity matches (fallback key)", async () => {
    const deps = buildDeps({ entities: [] });

    await handleSourceArticleIngested(deps, ingestedEvent());

    const [event] = deps.emitted as Array<{ payload: { fingerprint_hash: string } }>;
    expect(event?.payload.fingerprint_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws when the RawArticle cannot be found", async () => {
    const deps = buildDeps();
    deps.rawArticleRepository.getById = vi.fn(async () => null);

    await expect(handleSourceArticleIngested(deps, ingestedEvent())).rejects.toThrow("not found");
  });
});
