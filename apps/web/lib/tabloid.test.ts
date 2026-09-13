import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repositories } from "./db";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  project: vi.fn(),
  revalidate: vi.fn(),
  llm: {},
  env: { TABLOID_AUTO_PUBLISH: true },
  accepted: vi.fn((_title: string) => true),
  fetchFullArticle: vi.fn(),
  fetchImages: vi.fn(),
  fetchRss: vi.fn(),
}));
vi.mock("./env", () => ({ env: mocks.env }));
vi.mock("./tabloid-sources.json", () => ({ default: [{ id: "source-0" }, { id: "source-1" }] }));
vi.mock("./db", () => ({ createRepositories: vi.fn() }));
vi.mock("./logger", () => ({ getLogger: () => ({ info: vi.fn() }) }));
vi.mock("./llm", () => ({ getWriterLlmClient: () => mocks.llm }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@magyarsportonline/agents", () => ({
  tabloid: {
    writeTabloid: mocks.write,
    isFootballTabloid: mocks.accepted,
    TABLOID_MODEL: "gemini-3.5-flash",
    TABLOID_PROMPT: "tabloid-hu@2",
  },
  seo: { slugify: () => "magyar-hir" },
  readModelProjector: { handleStoryPublished: mocks.project },
  sourceIngest: {
    ArticleFetcher: class {
      fetch = mocks.fetchFullArticle;
      fetchWithMedia = async (...args: unknown[]) => {
        const [article, media] = await Promise.all([
          mocks.fetchFullArticle(...args),
          mocks.fetchImages(...args),
        ]);
        return article && media ? { article, media } : null;
      };
    },
    fetchArticleMedia: mocks.fetchImages,
    RssSourceAdapter: class {
      fetch = mocks.fetchRss;
    },
  },
}));
import { ingestTabloid, mergeInlineImages, publishTabloid } from "./tabloid";

function fixtures() {
  const raws = new Map(
    ["one", "two"].map((id, i) => [
      id,
      {
        id,
        sourceId: `source-${i}`,
        titleOriginal: "Same story",
        bodyOriginal: "A player's personal story",
        language: "en",
        sourceUrl: "https://example.com/same",
        imageUrl: null,
        publishedAtSource: null,
        ingestedAt: new Date("2026-09-11T00:00:00Z"),
      },
    ]),
  );
  const versions = new Map<string, Record<string, unknown>>();
  const stories = new Map<string, { id: string; slug: string | null; publishedAt: Date | null }>();
  const attempts = new Set();
  const repos = {
    rawArticleRepository: {
      withTabloidLock: (_: string, work: () => Promise<unknown>) => work(),
      getById: (id: string) => raws.get(id),
      linkToStory: vi.fn(),
      claimTabloidWriter: async (id: string) => {
        if (attempts.has(id)) return false;
        attempts.add(id);
        return true;
      },
      releaseTabloidQuotaDeferral: vi.fn(async (id: string) => attempts.delete(id)),
    },
    sourceRepository: {
      getById: (id: string) => ({
        id,
        name: "Source",
        fetchConfig: { tabloid: true, footballFeed: true },
      }),
    },
    storyRepository: {
      createOrMatchByFingerprint: async (key: string) => {
        if (!stories.has(key)) stories.set(key, { id: key, slug: null, publishedAt: null });
        return { story: stories.get(key), created: true };
      },
      trySetSlug: async () => true,
      publish: vi.fn(),
      getById: vi.fn(),
    },
    storySourceRepository: { link: vi.fn() },
    storyVersionRepository: {
      getLatest: async (id: string) => versions.get(id) ?? null,
      createNextVersion: async (id: string, input: Record<string, unknown>) => {
        const version = { ...input, id: `version-${id}` };
        versions.set(id, version);
        return version;
      },
      markPublished: vi.fn(),
    },
    storyReadModelRepository: {},
  } as unknown as Repositories;
  return { repos, versions, stories };
}

describe("tabloid publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.TABLOID_AUTO_PUBLISH = true;
    mocks.accepted.mockReturnValue(true);
    mocks.write.mockResolvedValue({
      title_hu: "Magyar hír",
      lead_hu: "Személyes történet.",
      body_hu: "A játékos a családjáról beszélt.",
    });
    mocks.project.mockResolvedValue(undefined);
    mocks.fetchImages.mockResolvedValue(null);
    mocks.fetchFullArticle.mockResolvedValue(null);
  });
  it("pauses ingest and publication before any repository or writer access", async () => {
    mocks.env.TABLOID_AUTO_PUBLISH = false;
    const repos = {} as Repositories;
    expect(await publishTabloid("one", repos)).toEqual({ paused: true, llmCalls: 0 });
    expect(await ingestTabloid(repos)).toEqual({ paused: true, llmCalls: 0 });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.project).not.toHaveBeenCalled();
  });
  it("never republishes a persisted v1 draft", async () => {
    const { repos, versions } = fixtures();
    mocks.project.mockRejectedValueOnce(new Error("projection"));
    await expect(publishTabloid("one", repos)).rejects.toThrow("projection");
    for (const version of versions.values()) version["promptVersion"] = "tabloid-hu@1";
    mocks.write.mockClear();
    mocks.project.mockClear();
    expect(await publishTabloid("one", repos)).toEqual({
      skipped: true,
      reason: "legacy-prompt-version",
    });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.project).not.toHaveBeenCalled();
  });
  it("stores rejected items and publishes accepted items only from a complete source page", async () => {
    const url = "https://publisher.test/photo.jpg?width=1200&signature=unchanged";
    mocks.accepted.mockImplementation((title) => title === "accepted");
    mocks.fetchRss.mockResolvedValue([
      {
        titleOriginal: "rejected",
        bodyOriginal: "transfer news",
        sourceUrl: "https://publisher.test/rejected",
        publishedAtSource: new Date(),
        imageUrl: null,
      },
      {
        titleOriginal: "accepted",
        bodyOriginal: "personal story",
        sourceUrl: "https://publisher.test/accepted",
        publishedAtSource: new Date(),
        imageUrl: url,
        image: { url, source: "media:content", width: 1200, height: 675 },
      },
    ]);
    mocks.fetchFullArticle.mockResolvedValue({
      titleOriginal: "accepted full title",
      subtitleOriginal: null,
      bodyOriginal: "Complete personal story from the source article page.",
      authorOriginal: "Reporter",
      publishedAtSource: new Date(),
    });
    mocks.fetchImages.mockResolvedValue({ primary: null, inlineImages: [] });
    const insert = vi.fn(async () => ({ id: "raw" }));
    const repos = {
      pipelineJobRepository: { getStatusCounts: async () => ({ pending: 0, inProgress: 0 }) },
      sourceRepository: {
        listActive: async () => [
          {
            id: "source-0",
            name: "Publisher",
            language: "en",
            fetchConfig: {
              tabloid: true,
              mode: "DIRECT_GOSSIP",
              footballFeed: true,
              url: "https://publisher.test/feed",
            },
          },
        ],
        recordFetchResult: vi.fn(),
      },
      rawArticleRepository: {
        insertTabloid: insert,
        listUnqueuedTabloidCandidates: vi.fn(async () => []),
        upgradeAndEnqueueTabloid: vi.fn(),
      },
    } as unknown as Repositories;
    await ingestTabloid(repos);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ titleOriginal: "rejected" }),
      false,
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        titleOriginal: "accepted full title",
        bodyOriginal: "Complete personal story from the source article page.",
        contentOrigin: "full_article",
        imageUrl: url,
      }),
      true,
    );
    expect(mocks.fetchImages).toHaveBeenCalledOnce();
    expect(mocks.fetchImages).toHaveBeenCalledWith(
      "https://publisher.test/accepted",
      "https://publisher.test/feed",
    );
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("defers an accepted RSS item when its complete source page cannot be extracted", async () => {
    mocks.fetchRss.mockResolvedValue([
      {
        titleOriginal: "accepted",
        bodyOriginal: "short RSS snippet about a footballer's private life",
        sourceUrl: "https://publisher.test/accepted",
        publishedAtSource: new Date(),
        imageUrl: null,
        contentOrigin: "rss_snippet",
      },
    ]);
    const insert = vi.fn();
    const repos = {
      pipelineJobRepository: { getStatusCounts: async () => ({ pending: 0, inProgress: 0 }) },
      sourceRepository: {
        listActive: async () => [
          {
            id: "source-0",
            name: "Publisher",
            language: "en",
            fetchConfig: {
              tabloid: true,
              mode: "DIRECT_GOSSIP",
              footballFeed: true,
              url: "https://publisher.test/feed",
            },
          },
        ],
        recordFetchResult: vi.fn(),
      },
      rawArticleRepository: {
        insertTabloid: insert,
        listUnqueuedTabloidCandidates: vi.fn(async () => []),
        upgradeAndEnqueueTabloid: vi.fn(),
      },
    } as unknown as Repositories;

    const result = await ingestTabloid(repos);

    expect(insert).not.toHaveBeenCalled();
    if (!("results" in result)) throw new Error("expected ingest result");
    expect(result.results[0]).toMatchObject({
      ingestedCount: 0,
      deferredWithoutFullArticle: 1,
    });
  });
  it("ingests only dated RSS items published after the activation watermark", async () => {
    const watermark = new Date("2026-09-12T19:00:00.000Z");
    mocks.fetchRss.mockResolvedValue([
      {
        titleOriginal: "old",
        bodyOriginal: "personal football story",
        sourceUrl: "https://publisher.test/old",
        publishedAtSource: new Date("2026-09-12T18:59:59.000Z"),
        imageUrl: null,
      },
      {
        titleOriginal: "undated",
        bodyOriginal: "personal football story",
        sourceUrl: "https://publisher.test/undated",
        publishedAtSource: null,
        imageUrl: null,
      },
      {
        titleOriginal: "new",
        bodyOriginal: "personal football story",
        sourceUrl: "https://publisher.test/new",
        publishedAtSource: new Date("2026-09-12T19:00:01.000Z"),
        imageUrl: null,
      },
    ]);
    mocks.fetchFullArticle.mockResolvedValue({
      titleOriginal: "new",
      subtitleOriginal: null,
      bodyOriginal: "Complete personal football story from the source page.",
      authorOriginal: null,
      publishedAtSource: new Date("2026-09-12T19:00:01.000Z"),
    });
    mocks.fetchImages.mockResolvedValue({ primary: null, inlineImages: [] });
    const insert = vi.fn(async () => ({ id: "raw" }));
    const repos = {
      pipelineJobRepository: { getStatusCounts: async () => ({ pending: 0, inProgress: 0 }) },
      sourceRepository: {
        listActive: async () => [
          {
            id: "source-0",
            name: "Publisher",
            language: "en",
            ingestWatermarkAt: watermark,
            fetchConfig: {
              tabloid: true,
              mode: "DIRECT_GOSSIP",
              footballFeed: true,
              url: "https://publisher.test/feed",
            },
          },
        ],
        recordFetchResult: vi.fn(),
      },
      rawArticleRepository: {
        insertTabloid: insert,
        listUnqueuedTabloidCandidates: vi.fn(async () => []),
        upgradeAndEnqueueTabloid: vi.fn(),
      },
    } as unknown as Repositories;

    await ingestTabloid(repos);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ titleOriginal: "new" }), true);
  });
  it("upgrades and queues old football items rejected by the former filter", async () => {
    mocks.fetchRss.mockResolvedValue([]);
    mocks.fetchFullArticle.mockResolvedValue({
      titleOriginal: "Complete match report",
      subtitleOriginal: null,
      bodyOriginal: "The complete football article from the publisher page.",
      authorOriginal: "Reporter",
      publishedAtSource: new Date("2026-09-13T08:00:00.000Z"),
    });
    mocks.fetchImages.mockResolvedValue({
      primary: { url: "https://cdn.test/hero.jpg", width: 1200, height: 675 },
      inlineImages: [{ url: "https://cdn.test/body.jpg" }],
    });
    const upgradeAndEnqueue = vi.fn(async () => true);
    const repos = {
      pipelineJobRepository: { getStatusCounts: async () => ({ pending: 0, inProgress: 0 }) },
      sourceRepository: {
        listActive: async () => [
          {
            id: "source-0",
            name: "Football feed",
            language: "en",
            ingestWatermarkAt: new Date(),
            fetchConfig: {
              tabloid: true,
              footballFeed: true,
              url: "https://publisher.test/feed",
            },
          },
        ],
        recordFetchResult: vi.fn(),
      },
      rawArticleRepository: {
        insertTabloid: vi.fn(),
        listUnqueuedTabloidCandidates: vi.fn(async () => [
          {
            id: "old-raw",
            sourceId: "source-0",
            sourceUrl: "https://publisher.test/old-match",
            titleOriginal: "Routine match report",
            bodyOriginal: "RSS fragment",
            imageUrl: null,
            publishedAtSource: new Date("2026-09-13T08:00:00.000Z"),
          },
        ]),
        upgradeAndEnqueueTabloid: upgradeAndEnqueue,
      },
    } as unknown as Repositories;

    const result = await ingestTabloid(repos);

    expect(upgradeAndEnqueue).toHaveBeenCalledWith(
      "old-raw",
      expect.objectContaining({
        bodyOriginal: "The complete football article from the publisher page.",
        inlineImages: [{ url: "https://cdn.test/body.jpg" }],
      }),
    );
    expect(result).toMatchObject({ backfilled: 1 });
  });
  it("keeps different sources separate even when content and URL are identical", async () => {
    const { repos, stories } = fixtures();
    await publishTabloid("one", repos);
    await publishTabloid("two", repos);
    expect(stories.size).toBe(2);
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });
  it("resumes projection failure from the persisted version without a second writer call", async () => {
    const { repos, versions } = fixtures();
    mocks.project.mockRejectedValueOnce(new Error("transient projection failure"));
    await expect(publishTabloid("one", repos)).rejects.toThrow("projection");
    expect(versions.size).toBe(1);
    await publishTabloid("one", repos);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.project).toHaveBeenCalledTimes(2);
  });
  it("creates a new Gemini version when an operator explicitly requests a rewrite", async () => {
    const { repos } = fixtures();
    await publishTabloid("one", repos);
    await publishTabloid("one", repos, { forceRewrite: true });
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(repos.rawArticleRepository.releaseTabloidQuotaDeferral).toHaveBeenCalledWith("one");
  });
  it("lets an explicit operator repair bypass the new-article topic filter", async () => {
    const { repos } = fixtures();
    mocks.accepted.mockReturnValue(false);

    await publishTabloid("one", repos, { retryFailedWriter: true, forceRewrite: true });

    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("lets an explicit operator repair a registry source with legacy database config", async () => {
    const { repos } = fixtures();
    repos.sourceRepository.getById = vi.fn(async (id: string) => ({
      id,
      name: "Source",
      fetchConfig: { footballFeed: true },
    })) as unknown as typeof repos.sourceRepository.getById;

    await publishTabloid("one", repos, { retryFailedWriter: true, forceRewrite: true });

    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("does not automatically repair or repeat failed generation", async () => {
    const { repos } = fixtures();
    mocks.write.mockRejectedValueOnce(new Error("invalid writer output"));
    await expect(publishTabloid("one", repos)).rejects.toThrow("invalid writer");
    await expect(publishTabloid("one", repos)).rejects.toThrow("already attempted");
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("retries a failed writer only when an operator explicitly requests recovery", async () => {
    const { repos } = fixtures();
    mocks.write.mockRejectedValueOnce(new Error("timed out"));
    await expect(publishTabloid("one", repos)).rejects.toThrow("timed out");

    await publishTabloid("one", repos, { retryFailedWriter: true });

    expect(repos.rawArticleRepository.releaseTabloidQuotaDeferral).toHaveBeenCalledWith("one");
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });
});

describe("source image merge", () => {
  it("collapses WordPress size variants of the same source photo", () => {
    const original = {
      url: "https://cdn.example.test/photo.jpg",
      alt: null,
      caption: null,
      credit: null,
      width: 1400,
      height: 900,
    };
    const resized = {
      ...original,
      url: "https://cdn.example.test/photo-1200x771.jpg",
      width: 1200,
      height: 771,
    };

    expect(mergeInlineImages([original], [resized])).toEqual([original]);
  });

  it("collapses publisher CDN presentation variants of the same photo", () => {
    const first = {
      url: "https://i2-prod.mirror.co.uk/article1.ece/ALTERNATES/s1200d/1_photo.jpg",
      alt: null,
      caption: null,
      credit: null,
      width: 1200,
      height: 800,
    };
    const second = {
      ...first,
      url: "https://i2-prod.mirror.co.uk/article1.ece/ALTERNATES/s1200f/1_photo.jpg",
    };

    expect(mergeInlineImages([first], [second])).toEqual([first]);
  });
});
