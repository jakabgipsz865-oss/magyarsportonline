import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock("./logger", () => ({ getLogger: () => logger }));
vi.mock("./env", () => ({
  env: {
    FACEBOOK_AUTO_PUBLISH: false,
    FACEBOOK_AUTO_PUBLISH_START_AT: new Date("2026-09-15T20:30:00.000Z"),
    SITE_URL: "https://mso24.hu",
  },
}));

import {
  buildFacebookPostText,
  enqueueFacebookPublication,
  enqueueFacebookPublicationSafely,
  enqueuePendingFacebookPosts,
} from "./facebook-publication";

function setup(options: { enabled?: boolean; created?: boolean; status?: string; enqueuedAt?: Date | null } = {}) {
  const post = {
    id: "social-1",
    storyId: "story-1",
    storyVersionId: "version-1",
    canonicalUrl: "https://mso24.hu/hir/uj-hir",
    status: options.status ?? "queued",
    enqueuedAt: options.enqueuedAt ?? null,
    createdAt: new Date("2026-09-15T20:31:00.000Z"),
  };
  const createFacebookQueued = vi.fn(async () => ({
    post,
    created: options.created ?? true,
  }));
  const markEnqueued = vi.fn();
  const send = vi.fn();
  const deps = {
    enabled: options.enabled ?? true,
    activationStart: new Date("2026-09-15T20:30:00.000Z"),
    siteUrl: "https://mso24.hu",
    socialPostRepository: {
      createFacebookQueued,
      markEnqueued,
      listPendingFacebookEnqueue: vi.fn(async () => [] as Array<typeof post>),
    },
    queue: { send },
  };
  const input = {
    storyId: "story-1",
    storyVersionId: "version-1",
    slug: "uj-hir",
    titleHu: "Új magyar futballhír",
    leadHu: "Ez a már elkészült magyar lead.",
    publishedAt: new Date("2026-09-15T20:31:00.000Z"),
    status: "published",
  };
  return { deps, input, createFacebookQueued, markEnqueued, send };
}

describe("Facebook publication hook", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enqueues a newly published Story with deterministic text and canonical MSO URL", async () => {
    const fixture = setup();
    await expect(enqueueFacebookPublication(fixture.input, fixture.deps)).resolves.toBe("enqueued");
    expect(fixture.createFacebookQueued).toHaveBeenCalledWith({
      storyId: "story-1",
      storyVersionId: "version-1",
      canonicalUrl: "https://mso24.hu/hir/uj-hir",
      postText:
        "⚽ Új magyar futballhír\n\nEz a már elkészült magyar lead.\n\n👇 Részletek:\nhttps://mso24.hu/hir/uj-hir",
    });
    expect(fixture.send).toHaveBeenCalledWith({
      socialPostId: "social-1",
      storyId: "story-1",
      storyVersionId: "version-1",
      canonicalUrl: "https://mso24.hu/hir/uj-hir",
    });
    expect(fixture.markEnqueued).toHaveBeenCalledWith("social-1");
  });

  it("does not enqueue an old Story, a draft, or when the feature is disabled", async () => {
    const old = setup();
    old.input.publishedAt = new Date("2026-09-15T20:29:59.000Z");
    await expect(enqueueFacebookPublication(old.input, old.deps)).resolves.toBe(
      "before_activation",
    );

    const draft = setup();
    draft.input.status = "draft";
    await expect(enqueueFacebookPublication(draft.input, draft.deps)).resolves.toBe("disabled");

    const disabled = setup({ enabled: false });
    await expect(enqueueFacebookPublication(disabled.input, disabled.deps)).resolves.toBe(
      "disabled",
    );
    expect(old.send).not.toHaveBeenCalled();
    expect(draft.send).not.toHaveBeenCalled();
    expect(disabled.send).not.toHaveBeenCalled();
  });

  it("does not enqueue a second post for the same Story or a later StoryVersion", async () => {
    const fixture = setup({ created: false, status: "posted" });
    fixture.input.storyVersionId = "version-2";
    await expect(enqueueFacebookPublication(fixture.input, fixture.deps)).resolves.toBe(
      "duplicate",
    );
    expect(fixture.send).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "facebook_duplicate_skipped" }),
      expect.any(String),
    );
  });

  it("sends a transactionally saved intent after a Worker restart", async () => {
    const fixture = setup({ created: false });
    await expect(enqueueFacebookPublication(fixture.input, fixture.deps)).resolves.toBe("enqueued");
    expect(fixture.send).toHaveBeenCalledOnce();
    expect(fixture.markEnqueued).toHaveBeenCalledWith("social-1");
  });

  it("shortens a long lead without generating a new sentence", () => {
    const lead = `${"magyar ".repeat(100)}vége`;
    const text = buildFacebookPostText({
      titleHu: "Cím",
      leadHu: lead,
      canonicalUrl: "https://mso24.hu/hir/cim",
    });
    expect(text.length).toBeLessThan(580);
    expect(text).toContain("…\n\n👇 Részletek:");
  });

  it("never lets a Facebook enqueue failure block Story publication", async () => {
    const fixture = setup();
    fixture.send.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(enqueueFacebookPublicationSafely(fixture.input, fixture.deps)).resolves.toBe(
      undefined,
    );
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("does not backfill a durable Facebook intent created before activation", async () => {
    const fixture = setup();
    fixture.deps.socialPostRepository.listPendingFacebookEnqueue.mockResolvedValueOnce([
      {
        id: "old-social", storyId: "old-story", storyVersionId: "old-version",
        canonicalUrl: "https://mso24.hu/hir/old-story", status: "queued",
        enqueuedAt: null, createdAt: new Date("2026-09-15T20:29:59.000Z"),
      },
    ]);
    await expect(enqueuePendingFacebookPosts(fixture.deps)).resolves.toEqual({
      disabled: false, enqueued: 0,
    });
    expect(fixture.deps.socialPostRepository.listPendingFacebookEnqueue)
      .toHaveBeenCalledWith(25, fixture.deps.activationStart);
    expect(fixture.send).not.toHaveBeenCalled();
  });
});
