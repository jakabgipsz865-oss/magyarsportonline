import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { D1SocialPostRepository, type D1Client, type D1Statement } from "@magyarsportonline/db/d1";
import { describe, expect, it, vi } from "vitest";
import { processFacebookMessage } from "./facebook";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

function localD1(db: DatabaseSyncType): D1Client {
  return {
    prepare(query): D1Statement {
      const statement = db.prepare(query);
      let values: (string | number | null)[] = [];
      return {
        bind(...input) { values = input.map(value => typeof value === "boolean" ? Number(value) : value); return this; },
        async first<T>() { return (statement.get(...values) as T | undefined) ?? null; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
      };
    },
  };
}

describe("Facebook consumer with D1 persistence", () => {
  it("posts one current intent and suppresses redelivery without a second Meta call", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`CREATE TABLE social_posts (
        id TEXT PRIMARY KEY, story_id TEXT NOT NULL, story_version_id TEXT NOT NULL,
        platform TEXT NOT NULL, external_post_id TEXT, post_text TEXT NOT NULL,
        canonical_url TEXT, status TEXT NOT NULL, error_code TEXT, last_error TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0, enqueued_at TEXT,
        last_attempt_at TEXT, posted_at TEXT, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (story_id, platform), UNIQUE (story_version_id, platform)
      )`);
      const repository = new D1SocialPostRepository(localD1(db));
      const { post } = await repository.createFacebookQueued({
        storyId: "story-new", storyVersionId: "version-new", postText: "Fresh",
        canonicalUrl: "https://mso24.hu/hir/fresh",
      });
      const ack = vi.fn();
      const message = {
        body: {
          socialPostId: post.id, storyId: post.storyId,
          storyVersionId: post.storyVersionId, canonicalUrl: post.canonicalUrl,
        },
        attempts: 1, ack, retry: vi.fn(),
      };
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "page_post_123" }),
        { status: 200 }));
      const env = {
        FACEBOOK_AUTO_PUBLISH: "true",
        FACEBOOK_AUTO_PUBLISH_START_AT: "2026-09-15T20:30:00.000Z",
        FACEBOOK_PAGE_ID: "page-id",
        FACEBOOK_PAGE_ACCESS_TOKEN: "test-token-never-print",
        META_GRAPH_API_VERSION: "v26.0",
      };
      const logger = { info: vi.fn(), error: vi.fn() };
      await processFacebookMessage(message, env, { repository, fetch: fetchMock, logger });
      expect((await repository.getById(post.id))?.status).toBe("posted");
      expect((await repository.getById(post.id))?.externalPostId).toBe("page_post_123");
      await processFacebookMessage(message, env, { repository, fetch: fetchMock, logger });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(ack).toHaveBeenCalledTimes(2);
    } finally {
      db.close();
    }
  });
});
