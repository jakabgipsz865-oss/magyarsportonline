import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const sourceId = "5416c5b2-fc48-4994-ac0f-fcc966b9cb83";
const mocks = vi.hoisted(() => ({
  env: { CRON_SECRET: "test-only", TABLOID_AUTO_PUBLISH: false },
  pause: vi.fn(),
  register: vi.fn(),
  listAll: vi.fn(),
  findProof: vi.fn(),
  latestPublished: vi.fn(),
  getRaw: vi.fn(),
  listRaws: vi.fn(),
  getStoryBySlug: vi.fn(),
  getSource: vi.fn(),
  updateInlineImages: vi.fn(),
  fetchMedia: vi.fn(),
  fetchRss: vi.fn(),
  writer: vi.fn(),
}));
vi.mock("@magyarsportonline/agents", () => ({
  sourceIngest: {
    fetchArticleMedia: mocks.fetchMedia,
    RssSourceAdapter: class {
      fetch = mocks.fetchRss;
    },
  },
  tabloid: {
    TABLOID_MODEL: "gemini-3.5-flash-lite",
    TABLOID_PROMPT: "tabloid-hu@2",
    isFootballTabloid: vi.fn(() => true),
  },
}));
vi.mock("../../../../lib/env", () => ({ env: mocks.env }));
vi.mock("../../../../lib/db", () => ({
  createRepositories: () => ({
    sourceRepository: {
      pauseTabloidSources: mocks.pause,
      registerTabloidSource: mocks.register,
      listAll: mocks.listAll,
      getById: mocks.getSource,
    },
    rawArticleRepository: {
      findTabloidProof: mocks.findProof,
      getById: mocks.getRaw,
      listByStoryId: mocks.listRaws,
      updateInlineImages: mocks.updateInlineImages,
    },
    storyVersionRepository: { getLatestPublished: mocks.latestPublished },
    storyReadModelRepository: { getBySlug: mocks.getStoryBySlug },
  }),
}));
vi.mock("../../../../lib/tabloid", () => ({
  mergeInlineImages: (...groups: Array<Array<{ url: string }> | undefined>) => {
    const seen = new Set<string>();
    return groups
      .flatMap((group) => group ?? [])
      .filter((image) => {
        if (seen.has(image.url)) return false;
        seen.add(image.url);
        return true;
      });
  },
  publishTabloid: mocks.writer,
}));
vi.mock("../../../../lib/tabloid-sources.json", () => ({
  default: [
    {
      id: "5416c5b2-fc48-4994-ac0f-fcc966b9cb83",
      name: "Daily Mail Football",
      mode: "BROAD_TABLOID_FOOTBALL",
    },
  ],
}));
import { GET, POST } from "./route";
function request(body: unknown, auth = "Bearer test-only") {
  return new NextRequest("https://example.test/api/internal/tabloid-rollout", {
    method: "POST",
    headers: { authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.TABLOID_AUTO_PUBLISH = false;
  mocks.listAll.mockResolvedValue([]);
  mocks.findProof.mockResolvedValue(null);
  mocks.latestPublished.mockResolvedValue(null);
  mocks.getRaw.mockResolvedValue(null);
  mocks.listRaws.mockResolvedValue([]);
  mocks.getStoryBySlug.mockResolvedValue(null);
  mocks.getSource.mockResolvedValue(null);
  mocks.fetchMedia.mockResolvedValue(null);
  mocks.fetchRss.mockResolvedValue([]);
});
describe("rollout status", () => {
  it("reports every enabled source even immediately after it was fetched", async () => {
    mocks.listAll.mockResolvedValue([
      { id: sourceId, name: "Daily Mail Football", isActive: true },
      { id: "inactive", name: "Inactive", isActive: false },
    ]);

    const response = await GET(
      new NextRequest("https://example.test/api/internal/tabloid-rollout", {
        headers: { authorization: "Bearer test-only" },
      }),
    );

    expect((await response.json()).activeSources).toEqual([
      { id: sourceId, name: "Daily Mail Football" },
    ]);
  });
});
describe("failed article recovery", () => {
  it("requires an already-linked article from the configured registry", async () => {
    mocks.env.TABLOID_AUTO_PUBLISH = true;
    mocks.getRaw.mockResolvedValue({ id: "raw", sourceId, storyId: "story" });
    mocks.writer.mockResolvedValue({ published: true, model: "gemini-3.5-flash-lite" });

    const response = await POST(
      request({ action: "retry-article", rawArticleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.writer).toHaveBeenCalledWith("raw", expect.any(Object), {
      retryFailedWriter: true,
    });
  });

  it("refreshes source images and creates a new Gemini version by public slug", async () => {
    const sourceImage = {
      url: "https://cdn.example.test/source.jpg",
      alt: "Source photo",
      caption: null,
      credit: null,
      width: 1200,
      height: 800,
    };
    mocks.env.TABLOID_AUTO_PUBLISH = true;
    mocks.getStoryBySlug.mockResolvedValue({ storyId: "story" });
    mocks.listRaws.mockResolvedValue([
      {
        id: "raw",
        sourceId,
        storyId: "story",
        sourceUrl: "https://publisher.test/story",
        imageUrl: null,
        inlineImages: [],
      },
    ]);
    mocks.getSource.mockResolvedValue({
      fetchConfig: { url: "https://publisher.test/feed" },
    });
    mocks.fetchRss.mockResolvedValue([
      {
        sourceUrl: "https://publisher.test/story",
        imageUrl: sourceImage.url,
        inlineImages: [sourceImage],
      },
    ]);
    mocks.writer.mockResolvedValue({ published: true, model: "gemini-3.5-flash-lite" });

    const response = await POST(request({ action: "rewrite-story", slug: "public-story" }));

    expect(response.status).toBe(200);
    expect(mocks.updateInlineImages).toHaveBeenCalledWith("raw", [sourceImage], sourceImage.url);
    expect(mocks.writer).toHaveBeenCalledWith("raw", expect.any(Object), {
      retryFailedWriter: true,
      forceRewrite: true,
    });
  });
});
describe("paused source reset", () => {
  it("requires authentication before any source write", async () => {
    expect(
      (await POST(request({ action: "reset-sources", sourceIds: [sourceId] }, "wrong"))).status,
    ).toBe(401);
    expect(mocks.pause).not.toHaveBeenCalled();
  });
  it("requires publication to remain paused", async () => {
    mocks.env.TABLOID_AUTO_PUBLISH = true;
    expect((await POST(request({ action: "reset-sources", sourceIds: [sourceId] }))).status).toBe(
      409,
    );
    expect(mocks.pause).not.toHaveBeenCalled();
  });
  it("rejects source IDs outside the preflighted registry", async () => {
    expect(
      (
        await POST(
          request({ action: "reset-sources", sourceIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.pause).not.toHaveBeenCalled();
  });
  it("pauses old sources and registers only selected sources without a Writer call", async () => {
    const response = await POST(request({ action: "reset-sources", sourceIds: [sourceId] }));
    expect(await response.json()).toEqual({ registered: 1, active: false, llmCalls: 0 });
    expect(mocks.pause).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: sourceId, mode: "BROAD_TABLOID_FOOTBALL" }),
    );
    expect(mocks.writer).not.toHaveBeenCalled();
    expect(mocks.env.TABLOID_AUTO_PUBLISH).toBe(false);
  });
  it("still refuses article generation while paused", async () => {
    expect((await POST(request({ action: "proof", language: "en" }))).status).toBe(409);
    expect(mocks.writer).not.toHaveBeenCalled();
  });
});
