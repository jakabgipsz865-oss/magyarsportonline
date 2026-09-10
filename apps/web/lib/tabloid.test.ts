import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repositories } from "./db";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  project: vi.fn(),
  revalidate: vi.fn(),
  llm: {},
}));
vi.mock("./db", () => ({ createRepositories: vi.fn() }));
vi.mock("./logger", () => ({ getLogger: () => ({ info: vi.fn() }) }));
vi.mock("./llm", () => ({ getWriterLlmClient: () => mocks.llm }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@magyarsportonline/agents", () => ({
  tabloid: {
    writeTabloid: mocks.write,
    isFootballTabloid: () => true,
    TABLOID_MODEL: "gemini-3.5-flash-lite",
    TABLOID_PROMPT: "tabloid-hu@1",
  },
  seo: { slugify: () => "magyar-hir" },
  readModelProjector: { handleStoryPublished: mocks.project },
  sourceIngest: {},
}));
import { publishTabloid } from "./tabloid";

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
      releaseTabloidQuotaDeferral: vi.fn(),
    },
    sourceRepository: {
      getById: () => ({ name: "Source", fetchConfig: { tabloid: true, footballFeed: true } }),
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
    mocks.write.mockResolvedValue({
      title_hu: "Magyar hír",
      lead_hu: "Személyes történet.",
      body_hu: "A játékos a családjáról beszélt.",
    });
    mocks.project.mockResolvedValue(undefined);
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
});
