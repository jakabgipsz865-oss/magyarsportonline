import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repositories } from "./db";

const logger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock("./db", () => ({
  createRepositories: vi.fn(),
}));

vi.mock("./logger", () => ({
  getLogger: () => logger,
}));

import { approveReviewItem } from "./review";

describe("approveReviewItem publication invariant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cannot publish a pending review item whose current content fails the fresh quality gate", async () => {
    const markPublished = vi.fn();
    const publish = vi.fn();
    const resolve = vi.fn();
    const repos = {
      reviewQueueRepository: {
        getById: vi.fn(async () => ({
          id: "review-1",
          storyId: "story-1",
          storyVersionId: "version-1",
          status: "pending",
        })),
        resolve,
      },
      storyRepository: {
        getById: vi.fn(async () => ({
          id: "story-1",
          credibilityScore: 72,
        })),
        publish,
      },
      storyVersionRepository: {
        getById: vi.fn(async () => ({
          id: "version-1",
          titleHu: "Meditate, pray és watch football instead of spreading hate",
          leadHu: "Ez a lead elég hosszú a minimális hossz ellenőrzéséhez.",
          bodyHu:
            "Ez a cikktörzs szándékosan elég hosszú ahhoz, hogy kizárólag az angol cím miatt bukjon el a friss publikációs ellenőrzésen.",
          isAiGenerated: true,
          factConsistencyScore: "1.000",
          selfCheckFallback: false,
        })),
        markPublished,
      },
      factRepository: {
        listByStoryId: vi.fn(async () => []),
      },
      storySourceRepository: {
        countByStoryId: vi.fn(async () => 1),
        countFullArticleByStoryId: vi.fn(async () => 1),
      },
    } as unknown as Repositories;

    const result = await approveReviewItem("review-1", repos);

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: "publication_blocked",
      }),
    );
    expect(markPublished).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
