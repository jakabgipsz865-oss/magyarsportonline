import type { SocialPost } from "@magyarsportonline/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processFacebookMessage } from "./facebook";

const TOKEN = "never-log-this-page-token";

function setup(overrides: Partial<SocialPost> = {}) {
  const post = {
    id: "social-1",
    storyId: "story-1",
    storyVersionId: "version-1",
    platform: "facebook",
    externalPostId: null,
    postText: "⚽ Cím\n\nLead\n\n👇 Részletek:\nhttps://magyarsportonline.hu/hir/cim",
    canonicalUrl: "https://magyarsportonline.hu/hir/cim",
    status: "queued",
    errorCode: null,
    lastError: null,
    attemptCount: 0,
    enqueuedAt: new Date(),
    lastAttemptAt: null,
    postedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SocialPost;
  const ack = vi.fn();
  const retry = vi.fn();
  const message = {
    body: {
      socialPostId: post.id,
      storyId: post.storyId,
      storyVersionId: post.storyVersionId,
      canonicalUrl: post.canonicalUrl,
    },
    attempts: 1,
    ack,
    retry,
  };
  const repository = {
    getById: vi.fn(async () => post),
    claimFacebookForPosting: vi.fn(async () => ({ ...post, status: "posting" }) as SocialPost),
    markPosted: vi.fn(),
    markFailed: vi.fn(),
  };
  const logger = { info: vi.fn(), error: vi.fn() };
  const fetchMock = vi.fn();
  const env = {
    FACEBOOK_AUTO_PUBLISH: "true",
    FACEBOOK_PAGE_ID: "110048870526768",
    FACEBOOK_PAGE_ACCESS_TOKEN: TOKEN,
    META_GRAPH_API_VERSION: "v26.0",
  };
  return { post, ack, retry, message, repository, logger, fetchMock, env };
}

describe("Facebook queue consumer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts the canonical MSO URL and stores a valid external post ID", async () => {
    const fixture = setup();
    fixture.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "110048870526768_123" }), { status: 200 }),
    );
    await processFacebookMessage(fixture.message, fixture.env, {
      repository: fixture.repository,
      fetch: fixture.fetchMock,
      logger: fixture.logger,
    });
    const [url, init] = fixture.fetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v26.0/110048870526768/feed");
    expect(String(init.body)).toContain("link=https%3A%2F%2Fmagyarsportonline.hu%2Fhir%2Fcim");
    expect(String(init.body)).not.toContain("example.com");
    expect(fixture.repository.markPosted).toHaveBeenCalledWith("social-1", "110048870526768_123");
    expect(fixture.ack).toHaveBeenCalledOnce();
    expect(fixture.retry).not.toHaveBeenCalled();
  });

  it("fails closed without retry on a permission error", async () => {
    const fixture = setup();
    fixture.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 200, message: "Permission denied" } }), {
        status: 403,
      }),
    );
    await processFacebookMessage(fixture.message, fixture.env, {
      repository: fixture.repository,
      fetch: fixture.fetchMock,
      logger: fixture.logger,
    });
    expect(fixture.repository.markFailed).toHaveBeenCalledWith(
      "social-1",
      "facebook_permission_denied",
      "Permission denied",
    );
    expect(fixture.ack).toHaveBeenCalledOnce();
    expect(fixture.retry).not.toHaveBeenCalled();
  });

  it("retries a rate limit at most within the bounded retry window", async () => {
    const fixture = setup();
    fixture.message.attempts = 3;
    fixture.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 4, message: "Rate limited" } }), {
        status: 429,
      }),
    );
    await processFacebookMessage(fixture.message, fixture.env, {
      repository: fixture.repository,
      fetch: fixture.fetchMock,
      logger: fixture.logger,
    });
    expect(fixture.repository.markFailed).toHaveBeenCalledWith(
      "social-1",
      "facebook_rate_limited",
      "Rate limited",
    );
    expect(fixture.retry).toHaveBeenCalledOnce();
    expect(fixture.ack).not.toHaveBeenCalled();
  });

  it("stops retrying a rate limit after the third automatic retry", async () => {
    const fixture = setup();
    fixture.message.attempts = 4;
    fixture.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 4, message: "Rate limited" } }), {
        status: 429,
      }),
    );
    await processFacebookMessage(fixture.message, fixture.env, {
      repository: fixture.repository,
      fetch: fixture.fetchMock,
      logger: fixture.logger,
    });
    expect(fixture.retry).not.toHaveBeenCalled();
    expect(fixture.ack).toHaveBeenCalledOnce();
  });

  it("does not blindly retry an ambiguous network failure", async () => {
    const fixture = setup();
    fixture.fetchMock.mockRejectedValue(new Error("timeout"));
    await processFacebookMessage(fixture.message, fixture.env, {
      repository: fixture.repository,
      fetch: fixture.fetchMock,
      logger: fixture.logger,
    });
    expect(fixture.repository.markFailed).toHaveBeenCalledWith(
      "social-1",
      "facebook_network_ambiguous",
      expect.any(String),
    );
    expect(fixture.retry).not.toHaveBeenCalled();
    expect(fixture.ack).toHaveBeenCalledOnce();
  });

  it("skips an already posted Story and never logs the Page token", async () => {
    const fixture = setup({ status: "posted", externalPostId: "existing" });
    await processFacebookMessage(fixture.message, fixture.env, {
      repository: fixture.repository,
      fetch: fixture.fetchMock,
      logger: fixture.logger,
    });
    expect(fixture.fetchMock).not.toHaveBeenCalled();
    expect(fixture.ack).toHaveBeenCalledOnce();
    expect(JSON.stringify(fixture.logger.info.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(fixture.logger.error.mock.calls)).not.toContain(TOKEN);
  });

  it("treats a redelivered posting claim as ambiguous instead of reposting", async () => {
    const fixture = setup({ status: "posting" });
    fixture.message.attempts = 2;
    await processFacebookMessage(fixture.message, fixture.env, {
      repository: fixture.repository,
      fetch: fixture.fetchMock,
      logger: fixture.logger,
    });
    expect(fixture.repository.markFailed).toHaveBeenCalledWith(
      "social-1",
      "facebook_network_ambiguous",
      expect.any(String),
    );
    expect(fixture.fetchMock).not.toHaveBeenCalled();
    expect(fixture.retry).not.toHaveBeenCalled();
  });
});
