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
  writer: vi.fn(),
}));
vi.mock("../../../../lib/env", () => ({ env: mocks.env }));
vi.mock("../../../../lib/db", () => ({
  createRepositories: () => ({
    sourceRepository: {
      pauseTabloidSources: mocks.pause,
      registerTabloidSource: mocks.register,
      listAll: mocks.listAll,
    },
    rawArticleRepository: { findTabloidProof: mocks.findProof, getById: mocks.getRaw },
    storyVersionRepository: { getLatestPublished: mocks.latestPublished },
  }),
}));
vi.mock("../../../../lib/tabloid", () => ({ publishTabloid: mocks.writer }));
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
