import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock("./logger", () => ({ getLogger: () => logger }));
vi.mock("./env", () => ({
  env: {
    FACEBOOK_AUTO_PUBLISH: false,
    FACEBOOK_AUTO_PUBLISH_START_AT: new Date("2026-09-15T20:30:00.000Z"),
    SITE_URL: "https://magyarsportonline.hu",
  },
}));

import {
  buildFacebookPostText,
  enqueueFacebookPublication,
  enqueueFacebookPublicationSafely,
} from "./facebook-publication";

function setup(options: { enabled?: boolean; created?: boolean } = {}) {
  const post = {
    id: "social-1",
    storyId: "story-1",
    storyVersionId: "version-1",
    canonicalUrl: "https://magyarsportonline.hu/hir/uj-hir",
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
    siteUrl: "https://magyarsportonline.hu",
    socialPostRepository: {
      createFacebookQueued,
      markEnqueued,
      listPendingFacebookEnqueue: vi.fn(async () => []),
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
      canonicalUrl: "https://magyarsportonline.hu/hir/uj-hir",
      postText:
        "⚽ Új magyar futballhír\n\nEz a már elkészült magyar lead.\n\n👇 Részletek:\nhttps://magyarsportonline.hu/hir/uj-hir",
    });
    expect(fixture.send).toHaveBeenCalledWith({
      socialPostId: "social-1",
      storyId: "story-1",
      storyVersionId: "version-1",
      canonicalUrl: "https://magyarsportonline.hu/hir/uj-hir",
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
    const fixture = setup({ created: false });
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

  it("shortens a long lead without generating a new sentence", () => {
    const lead = `${"magyar ".repeat(100)}vége`;
    const text = buildFacebookPostText({
      titleHu: "Cím",
      leadHu: lead,
      canonicalUrl: "https://magyarsportonline.hu/hir/cim",
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
});
