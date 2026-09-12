import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repositories } from "./db";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  project: vi.fn(),
  revalidate: vi.fn(),
  llm: {},
  env: { TABLOID_AUTO_PUBLISH: true },
  accepted: vi.fn((_title: string) => true),
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
    TABLOID_MODEL: "gemini-3.5-flash-lite",
    TABLOID_PROMPT: "tabloid-hu@2",
  },
  seo: { slugify: () => "magyar-hir" },
  readModelProjector: { handleStoryPublished: mocks.project },
  sourceIngest: {
    fetchArticleImage: mocks.fetchImages,
    RssSourceAdapter: class {
      fetch = mocks.fetchRss;
    },
  },
}));
import { ingestTabloid, publishTabloid } from "./tabloid";

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
    expect(await publishTabloid("one", repos)).toEqual({ skipped: true });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.project).not.toHaveBeenCalled();
  });
  it("stores rejected raw items without a queue job or an HTML/image request, and preserves selected remote URLs", async () => {
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
      rawArticleRepository: { insertTabloid: insert },
    } as unknown as Repositories;
    await ingestTabloid(repos);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ titleOriginal: "rejected" }),
      false,
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ titleOriginal: "accepted", imageUrl: url }),
      true,
    );
    expect(mocks.fetchImages).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
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
      rawArticleRepository: { insertTabloid: insert },
    } as unknown as Repositories;

    await ingestTabloid(repos);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ titleOriginal: "new" }), true);
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
