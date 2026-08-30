import { createLogger } from "@magyarsportonline/observability";
import { describe, expect, it, vi } from "vitest";
import { runSourceIngest, type SourceIngestDeps } from "./index";
import type { SourceAdapter } from "./types";

const WATERMARK = new Date("2026-08-30T10:00:00.000Z");
const NEW_ARTICLE_TIME = new Date("2026-08-30T10:01:00.000Z");

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
  lastSuccessAt: WATERMARK as Date | null,
  ingestWatermarkAt: WATERMARK as Date | null,
  lastErrorAt: null,
};

const SOURCE_2 = {
  ...SOURCE,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Sky Sports - Football",
  baseUrl: "https://www.skysports.com/football",
  fetchConfig: { url: "https://www.skysports.com/rss/12040" },
};

function buildDeps(overrides?: {
  existingUrls?: Set<string>;
  existingOrigin?: "rss_snippet" | "full_article";
  adapter?: SourceAdapter;
  sources?: (typeof SOURCE)[];
  maxNewArticlesPerRun?: number;
}): SourceIngestDeps & {
  inserted: Array<{ sourceUrl: string }>;
  upgraded: Array<{ id: string; bodyOriginal: string }>;
  emitted: unknown[];
  fetchResults: Array<{ sourceId: string; status: string }>;
  watermarks: Date[];
} {
  const existingUrls = overrides?.existingUrls ?? new Set<string>();
  const inserted: Array<{ sourceUrl: string }> = [];
  const upgraded: Array<{ id: string; bodyOriginal: string }> = [];
  const emitted: unknown[] = [];
  const fetchResults: Array<{ sourceId: string; status: string }> = [];
  const watermarks: Date[] = [];
  const activeSources = (overrides?.sources ?? [SOURCE]).map((source) => ({ ...source }));

  const deps: SourceIngestDeps & {
    inserted: Array<{ sourceUrl: string }>;
    upgraded: Array<{ id: string; bodyOriginal: string }>;
    emitted: unknown[];
    fetchResults: Array<{ sourceId: string; status: string }>;
    watermarks: Date[];
  } = {
    sourceRepository: {
      listActive: vi.fn(async () => activeSources),
      recordFetchResult: vi.fn(async (sourceId: string, result: { status: "ok" | "error" }) => {
        fetchResults.push({ sourceId, status: result.status });
      }),
      advanceIngestWatermark: vi.fn(async (sourceId: string, watermark: Date) => {
        watermarks.push(watermark);
        const source = activeSources.find(({ id }) => id === sourceId);
        if (source && (!source.ingestWatermarkAt || watermark > source.ingestWatermarkAt)) {
          source.ingestWatermarkAt = watermark;
        }
      }),
    },
    rawArticleRepository: {
      findBySourceUrl: vi.fn(async (url: string) =>
        existingUrls.has(url)
          ? ({
              id: "existing",
              contentOrigin: overrides?.existingOrigin ?? "full_article",
            } as never)
          : null,
      ),
      insert: vi.fn(async (data: { sourceUrl: string }) => {
        inserted.push({ sourceUrl: data.sourceUrl });
        existingUrls.add(data.sourceUrl);
        return { id: `new-${inserted.length}`, ...data } as never;
      }),
      upgradeFromFullArticle: vi.fn(
        async (id: string, data: { bodyOriginal: string }): Promise<boolean> => {
          upgraded.push({ id, bodyOriginal: data.bodyOriginal });
          return true;
        },
      ),
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
              publishedAtSource: NEW_ARTICLE_TIME,
              imageUrl: null,
              contentOrigin: "full_article",
            },
          ],
        } satisfies SourceAdapter),
    },
    maxNewArticlesPerRun: overrides?.maxNewArticlesPerRun,
    logger: createLogger({
      destination: { write: () => true } as unknown as NodeJS.WritableStream,
    }),
    inserted,
    upgraded,
    emitted,
    fetchResults,
    watermarks,
  };
  return deps;
}

describe("runSourceIngest", () => {
  it("uses the first successful fetch only as a freshness baseline", async () => {
    const deps = buildDeps({ sources: [{ ...SOURCE, ingestWatermarkAt: null }] });

    const results = await runSourceIngest(deps);

    expect(results[0]).toMatchObject({ ingestedCount: 0, status: "ok" });
    expect(deps.inserted).toEqual([]);
    expect(deps.emitted).toEqual([]);
    expect(deps.watermarks).toEqual([NEW_ARTICLE_TIME]);
    expect(deps.fetchResults).toEqual([{ sourceId: SOURCE.id, status: "ok" }]);
  });

  it("leaves the baseline watermark null when the feed has no valid timestamp", async () => {
    const deps = buildDeps({
      sources: [{ ...SOURCE, ingestWatermarkAt: null }],
      adapter: {
        fetch: async () => [
          {
            sourceUrl: "https://example.com/no-time",
            titleOriginal: "No time",
            subtitleOriginal: null,
            bodyOriginal: "Body",
            authorOriginal: null,
            publishedAtSource: null,
            imageUrl: null,
            contentOrigin: "full_article",
          },
        ],
      },
    });

    await runSourceIngest(deps);

    expect(deps.watermarks).toEqual([]);
    expect(deps.inserted).toEqual([]);
    expect(deps.emitted).toEqual([]);
  });

  it("ingests two newest-first articles losslessly across cap=1 runs", async () => {
    const firstTime = new Date("2026-08-30T10:01:00.000Z");
    const secondTime = new Date("2026-08-30T10:02:00.000Z");
    const deps = buildDeps({
      maxNewArticlesPerRun: 1,
      adapter: {
        fetch: async () =>
          [
            { sourceUrl: "https://example.com/b", publishedAtSource: secondTime },
            { sourceUrl: "https://example.com/a", publishedAtSource: firstTime },
          ].map((article) => ({
            ...article,
            titleOriginal: "Title",
            subtitleOriginal: null,
            bodyOriginal: "Body",
            authorOriginal: null,
            imageUrl: null,
            contentOrigin: "full_article" as const,
          })),
      },
    });

    expect((await runSourceIngest(deps))[0]?.ingestedCount).toBe(1);
    expect(deps.inserted).toEqual([{ sourceUrl: "https://example.com/a" }]);
    expect(deps.watermarks).toEqual([firstTime]);

    expect((await runSourceIngest(deps))[0]?.ingestedCount).toBe(1);
    expect(deps.inserted).toEqual([
      { sourceUrl: "https://example.com/a" },
      { sourceUrl: "https://example.com/b" },
    ]);
    expect(deps.watermarks).toEqual([firstTime, secondTime]);
  });

  it.each([
    ["older", new Date("2026-08-30T09:59:59.999Z")],
    ["equal", WATERMARK],
    ["missing", null],
  ])("skips an article with a %s publication timestamp", async (_label, publishedAtSource) => {
    const deps = buildDeps({
      adapter: {
        fetch: async () => [
          {
            sourceUrl: "https://example.com/not-fresh",
            titleOriginal: "Not fresh",
            subtitleOriginal: null,
            bodyOriginal: "Body",
            authorOriginal: null,
            publishedAtSource,
            imageUrl: null,
            contentOrigin: "full_article",
          },
        ],
      },
    });

    const results = await runSourceIngest(deps);

    expect(results[0]).toMatchObject({ ingestedCount: 0, status: "ok" });
    expect(deps.inserted).toEqual([]);
    expect(deps.emitted).toEqual([]);
  });

  it("inserts a new RawArticle and emits source/article.ingested", async () => {
    const deps = buildDeps();

    const results = await runSourceIngest(deps);

    expect(results).toEqual([
      { sourceId: SOURCE.id, sourceName: SOURCE.name, ingestedCount: 1, status: "ok" },
    ]);
    expect(deps.inserted).toEqual([{ sourceUrl: "https://example.com/1" }]);
    expect(deps.emitted).toHaveLength(1);
    const [event] = deps.emitted as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(event?.type).toBe("source/article.ingested");
    expect(event?.payload["source_id"]).toBe(SOURCE.id);
    expect(deps.fetchResults).toEqual([{ sourceId: SOURCE.id, status: "ok" }]);
  });

  it("skips URLs that already exist (idempotent ingest)", async () => {
    const deps = buildDeps();

    const firstResults = await runSourceIngest(deps);
    const secondResults = await runSourceIngest(deps);

    expect(firstResults).toEqual([
      { sourceId: SOURCE.id, sourceName: SOURCE.name, ingestedCount: 1, status: "ok" },
    ]);
    expect(secondResults).toEqual([
      { sourceId: SOURCE.id, sourceName: SOURCE.name, ingestedCount: 0, status: "ok" },
    ]);
    expect(deps.inserted).toEqual([{ sourceUrl: "https://example.com/1" }]);
    expect(deps.emitted).toHaveLength(1);
    expect(deps.upgraded).toEqual([]);
  });

  it("upgrades an existing RSS snippet when full article extraction later succeeds", async () => {
    const deps = buildDeps({
      existingUrls: new Set(["https://example.com/1"]),
      existingOrigin: "rss_snippet",
    });

    const results = await runSourceIngest(deps);

    expect(results).toEqual([
      { sourceId: SOURCE.id, sourceName: SOURCE.name, ingestedCount: 0, status: "ok" },
    ]);
    expect(deps.inserted).toEqual([]);
    expect(deps.emitted).toEqual([]);
    expect(deps.upgraded).toEqual([{ id: "existing", bodyOriginal: "Body" }]);
  });

  it("shares maxNewArticlesPerRun across all active sources, not per source (2026-07-29 fix)", async () => {
    // Regression test for a real production 504: with the cap reset per
    // source, 2 active sources each getting their own budget of 1 still
    // processed 2 full downstream pipelines in one request. The budget must
    // be a single, shared total across the whole run.
    let call = 0;
    const deps = buildDeps({
      sources: [SOURCE, SOURCE_2],
      maxNewArticlesPerRun: 1,
      adapter: {
        fetch: async () => {
          call += 1;
          return [
            {
              sourceUrl: `https://example.com/${call}`,
              titleOriginal: "Title",
              subtitleOriginal: null,
              bodyOriginal: "Body",
              authorOriginal: null,
              publishedAtSource: NEW_ARTICLE_TIME,
              imageUrl: null,
              contentOrigin: "full_article",
            },
          ];
        },
      },
    });

    const results = await runSourceIngest(deps);

    expect(deps.inserted).toHaveLength(1);
    expect(deps.emitted).toHaveLength(1);
    expect(results).toEqual([
      { sourceId: SOURCE.id, sourceName: SOURCE.name, ingestedCount: 1, status: "ok" },
      { sourceId: SOURCE_2.id, sourceName: SOURCE_2.name, ingestedCount: 0, status: "ok" },
    ]);
    // The skipped second source was never actually fetched this run — its
    // fetch result (and therefore lastFetchedAt) must be left untouched, so
    // it naturally sorts first next run (source-repository.ts listActive).
    expect(deps.fetchResults).toEqual([{ sourceId: SOURCE.id, status: "ok" }]);
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

    expect(results).toEqual([
      { sourceId: SOURCE.id, sourceName: SOURCE.name, ingestedCount: 0, status: "error" },
    ]);
    expect(deps.fetchResults).toEqual([{ sourceId: SOURCE.id, status: "error" }]);
  });
});
