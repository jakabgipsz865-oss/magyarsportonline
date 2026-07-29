import { describe, expect, it, vi } from "vitest";
import type { PublicContentRecoveryDeps } from "./public-content-recovery";
import {
  recoverUnsafePublicContent,
  retractPublicContentOlderThan,
} from "./public-content-recovery";

const SAFE_BODY =
  "Az első félidő kiegyenlített küzdelmet hozott, egyik fél sem tudott komoly előnyt kialakítani. A fordulás után egy pontos beadást követő fejes döntötte el a találkozót.";

function deps(): PublicContentRecoveryDeps & {
  statusUpdates: string[];
  projectionDeletes: string[];
} {
  const statusUpdates: string[] = [];
  const projectionDeletes: string[] = [];
  const rows = [
    {
      storyId: "unsafe",
      slug: "unsafe-story",
      titleHu: "Meditate, pray és watch football instead of spreading hate",
      leadHu: "Ez a lead elég hosszú a minimális hossz ellenőrzéséhez.",
      publishedAt: new Date("2026-07-28T10:00:00.000Z"),
    },
    {
      storyId: "safe",
      slug: "safe-story",
      titleHu: "Magyar győzelem született a rangadón",
      leadHu: "A válogatott fegyelmezett játékkal nyerte meg a fontos mérkőzést.",
      publishedAt: new Date("2026-07-28T11:00:00.000Z"),
    },
  ];

  return {
    storyReadModelRepository: {
      listPublished: vi.fn(async () => rows as never),
      deleteByStoryId: vi.fn(async (storyId: string) => {
        projectionDeletes.push(storyId);
      }),
    },
    storyRepository: {
      getById: vi.fn(
        async (storyId: string) =>
          ({
            id: storyId,
            currentVersionId: `version-${storyId}`,
            credibilityScore: 70,
          }) as never,
      ),
      updateStatus: vi.fn(async (storyId: string) => {
        statusUpdates.push(storyId);
      }),
    },
    storyVersionRepository: {
      getById: vi.fn(
        async (versionId: string) =>
          ({
            id: versionId,
            titleHu: versionId.endsWith("unsafe")
              ? "Meditate, pray és watch football instead of spreading hate"
              : "Magyar győzelem született a rangadón",
            leadHu: "A válogatott fegyelmezett játékkal nyerte meg a fontos mérkőzést.",
            bodyHu: SAFE_BODY,
            isAiGenerated: true,
            factConsistencyScore: "1.000",
            selfCheckFallback: false,
          }) as never,
      ),
    },
    factRepository: { listByStoryId: vi.fn(async () => []) },
    storySourceRepository: {
      countByStoryId: vi.fn(async () => 1),
      countFullArticleByStoryId: vi.fn(async () => 1),
    },
    reviewQueueRepository: {
      rejectAllPendingForStory: vi.fn(async () => undefined),
    },
    statusUpdates,
    projectionDeletes,
  };
}

describe("recoverUnsafePublicContent", () => {
  it("dry-run reports unsafe rows without mutating public state", async () => {
    const repositories = deps();
    const result = await recoverUnsafePublicContent(repositories, { apply: false });

    expect(result).toEqual(
      expect.objectContaining({ dryRun: true, scanned: 2, kept: 1, retracted: 1 }),
    );
    expect(repositories.statusUpdates).toEqual([]);
    expect(repositories.projectionDeletes).toEqual([]);
  });

  it("retracts only rows that fail the current publication invariant", async () => {
    const repositories = deps();
    const result = await recoverUnsafePublicContent(repositories, { apply: true });

    expect(result).toEqual(expect.objectContaining({ dryRun: false, kept: 1, retracted: 1 }));
    expect(repositories.statusUpdates).toEqual(["unsafe"]);
    expect(repositories.projectionDeletes).toEqual(["unsafe"]);
  });
});

describe("retractPublicContentOlderThan", () => {
  it("keeps freshly regenerated projections and retracts older public content", async () => {
    const repositories = deps();
    const result = await retractPublicContentOlderThan(
      repositories,
      new Date("2026-07-28T10:30:00.000Z"),
    );

    expect(result).toEqual(
      expect.objectContaining({
        scanned: 2,
        kept: 1,
        retracted: 1,
        retractedStories: [expect.objectContaining({ storyId: "unsafe", slug: "unsafe-story" })],
      }),
    );
    expect(repositories.statusUpdates).toEqual(["unsafe"]);
    expect(repositories.projectionDeletes).toEqual(["unsafe"]);
  });
});
