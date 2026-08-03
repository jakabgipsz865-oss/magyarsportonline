import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorialCorrectionInput } from "@magyarsportonline/db";
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

import {
  approveReviewItem,
  buildTeachableCorrectionsFromEdit,
  editReviewItemContent,
} from "./review";

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

describe("review edit learning loop", () => {
  it("extracts only changed sentence pairs from an edited Hungarian article", () => {
    const corrections = buildTeachableCorrectionsFromEdit({
      storyId: "11111111-1111-4111-8111-111111111111",
      category: "terminology",
      originalContextEn: "The substitute scored the winner. The crowd celebrated.",
      before: {
        titleHu: "A szuper csere eldöntötte a meccset",
        leadHu: "A hajrában született a győztes gól.",
        bodyHu: "A csapat végig támadott. A szuper csere a hajrában betalált.",
      },
      after: {
        titleHu: "A csereember eldöntötte a meccset",
        leadHu: "A hajrában született a győztes gól.",
        bodyHu: "A csapat végig támadott. A padról beszálló játékos a hajrában betalált.",
      },
    });

    expect(corrections).toHaveLength(2);
    expect(corrections.map((item) => [item.currentSentenceHu, item.correctedSentenceHu])).toEqual([
      ["A szuper csere eldöntötte a meccset", "A csereember eldöntötte a meccset"],
      ["A szuper csere a hajrában betalált.", "A padról beszálló játékos a hajrában betalált."],
    ]);
  });

  it("saves changed sentences as portable corrections after a successful draft edit", async () => {
    const correctionCreate = vi.fn(async (input: EditorialCorrectionInput) => ({
      id: crypto.randomUUID(),
      ...input,
    }));
    const repos = {
      reviewQueueRepository: {
        getById: vi.fn(async () => ({
          id: "review-1",
          storyId: "11111111-1111-4111-8111-111111111111",
          storyVersionId: "version-1",
          status: "pending",
        })),
      },
      storyVersionRepository: {
        getById: vi.fn(async () => ({
          id: "version-1",
          titleHu: "A szuper csere döntött",
          leadHu: "A régi lead megfelelő hosszúságú marad a teszthez.",
          bodyHu: "A régi törzs első mondata. A második mondat változatlan marad.",
          editorialRewriteApplied: false,
        })),
        updateDraftContent: vi.fn(async () => true),
      },
      factRepository: { listByStoryId: vi.fn(async () => []) },
      editorialCorrectionRepository: { create: correctionCreate },
    } as unknown as Repositories;

    const result = await editReviewItemContent(
      "review-1",
      {
        titleHu: "A csereember döntött",
        leadHu: "A régi lead megfelelő hosszúságú marad a teszthez.",
        bodyHu: "A régi törzs első mondata. A második mondat változatlan marad.",
      },
      repos,
      {
        enabled: true,
        category: "terminology",
        originalContextEn: "The substitute scored the winner.",
      },
    );

    expect(result).toEqual({ ok: true, correctionsCreated: 1 });
    expect(correctionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSentenceHu: "A szuper csere döntött",
        correctedSentenceHu: "A csereember döntött",
        originalSentenceEn: "The substitute scored the winner.",
      }),
    );
  });
});
