import { createLogger } from "@magyarsportonline/observability";
import { describe, expect, it, vi } from "vitest";
import { runSourceIngest, type SourceIngestDeps } from "./index";
import type { SourceAdapter } from "./types";

const SOURCE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "BBC Sport - Football",
  baseUrl: "https://www.bbc.co.uk/sport/football",
  type: "rss" as const,
  language: "en",
  licenseType: "public_rss" as const,
  reliabilityTier: "B" as const,
  fetchConfig: { url: "https://feeds.bbci.co.uk/sport/football/rss.xml" },
  isActive: true,
  onboardedAt: new Date(),
  lastFetchedAt: null,
  lastFetchStatus: null,
};

function buildDeps(overrides?: {
  existingUrls?: Set<string>;
  adapter?: SourceAdapter;
}): SourceIngestDeps & {
  inserted: Array<{ sourceUrl: string }>;
  emitted: unknown[];
  fetchResults: Array<{ sourceId: string; status: string }>;
} {
  const existingUrls = overrides?.existingUrls ?? new Set<string>();
  const inserted: Array<{ sourceUrl: string }> = [];
  const emitted: unknown[] = [];
  const fetchResults: Array<{ sourceId: string; status: string }> = [];

  const deps: SourceIngestDeps & {
    inserted: Array<{ sourceUrl: string }>;
    emitted: unknown[];
    fetchResults: Array<{ sourceId: string; status: string }>;
  } = {
    sourceRepository: {
      listActive: vi.fn(async () => [SOURCE]),
      recordFetchResult: vi.fn(async (sourceId: string, result: { status: "ok" | "error" }) => {
        fetchResults.push({ sourceId, status: result.status });
      }),
    },
    rawArticleRepository: {
      findBySourceUrl: vi.fn(async (url: string) =>
        existingUrls.has(url) ? ({ id: "existing" } as never) : null,
      ),
      insert: vi.fn(async (data: { sourceUrl: string }) => {
        inserted.push({ sourceUrl: data.sourceUrl });
        return { id: `new-${inserted.length}`, ...data } as never;
      }),
    },
    agentRunRepository: { record: vi.fn(async () => undefined) },
    dispatcher: {
      emit: vi.fn(async (event: unknown) => {
        emitted.push(event);
      }),
    },
    adapters: {
      rss:
        overrides?.adapter ??
        ({
          fetch: async () => [
            {
              sourceUrl: "https://example.com/1",
              titleOriginal: "Title",
              subtitleOriginal: null,
              bodyOriginal: "Body",
              authorOriginal: null,
              publishedAtSource: null,
              imageUrl: null,
            },
          ],
        } satisfies SourceAdapter),
    },
    logger: createLogger({
      destination: { write: () => true } as unknown as NodeJS.WritableStream,
    }),
    inserted,
    emitted,
    fetchResults,
  };
  return deps;
}

describe("runSourceIngest", () => {
  it("inserts a new RawArticle and emits source/article.ingested", async () => {
    const deps = buildDeps();

    const results = await runSourceIngest(deps);

    expect(results).toEqual([{ sourceId: SOURCE.id, ingestedCount: 1, status: "ok" }]);
    expect(deps.inserted).toEqual([{ sourceUrl: "https://example.com/1" }]);
    expect(deps.emitted).toHaveLength(1);
    const [event] = deps.emitted as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(event?.type).toBe("source/article.ingested");
    expect(event?.payload["source_id"]).toBe(SOURCE.id);
    expect(deps.fetchResults).toEqual([{ sourceId: SOURCE.id, status: "ok" }]);
  });

  it("skips URLs that already exist (idempotent ingest)", async () => {
    const deps = buildDeps({ existingUrls: new Set(["https://example.com/1"]) });

    const results = await runSourceIngest(deps);

    expect(results).toEqual([{ sourceId: SOURCE.id, ingestedCount: 0, status: "ok" }]);
    expect(deps.inserted).toEqual([]);
    expect(deps.emitted).toEqual([]);
  });

  it("records a failed fetch result and continues without throwing", async () => {
    const deps = buildDeps({
      adapter: {
        fetch: async () => {
          throw new Error("feed unreachable");
        },
      },
    });

    const results = await runSourceIngest(deps);

    expect(results).toEqual([{ sourceId: SOURCE.id, ingestedCount: 0, status: "error" }]);
    expect(deps.fetchResults).toEqual([{ sourceId: SOURCE.id, status: "error" }]);
  });
});
