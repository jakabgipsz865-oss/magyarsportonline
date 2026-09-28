import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { D1SocialPostRepository } from "./social-post-repository";
import type { D1Client, D1Statement } from "./client";

// Vitest 2's Vite resolver predates node:sqlite, so load the built-in at runtime.
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

function fixture(): DatabaseSyncType {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE social_posts (
      id TEXT PRIMARY KEY, story_id TEXT NOT NULL, story_version_id TEXT NOT NULL,
      platform TEXT NOT NULL, external_post_id TEXT, post_text TEXT NOT NULL,
      canonical_url TEXT, status TEXT NOT NULL, error_code TEXT, last_error TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0, enqueued_at TEXT,
      last_attempt_at TEXT, posted_at TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (story_id, platform), UNIQUE (story_version_id, platform)
    );
  `);
  return db;
}

describe("D1 social post idempotency", () => {
  it("creates one durable intent, claims once, and does not retry an ambiguous Meta outcome", async () => {
    const db = fixture();
    try {
      const repository = new D1SocialPostRepository(localD1(db));
      const input = {
        storyId: "story-1", storyVersionId: "version-1", postText: "Fresh article",
        canonicalUrl: "https://mso24.hu/hir/fresh-article",
      };
      const first = await repository.createFacebookQueued(input);
      const duplicate = await repository.createFacebookQueued(input);
      expect(first.created).toBe(true);
      expect(duplicate).toEqual({ post: first.post, created: false });
      expect((db.prepare("SELECT count(*) AS n FROM social_posts").get() as { n: number }).n).toBe(1);

      const claimed = await repository.claimFacebookForPosting(first.post.id);
      expect(claimed?.attemptCount).toBe(1);
      expect(await repository.claimFacebookForPosting(first.post.id)).toBeNull();
      await repository.markFailed(first.post.id, "facebook_network_ambiguous", "response lost");
      expect(await repository.claimFacebookForPosting(first.post.id)).toBeNull();
      expect((await repository.getById(first.post.id))?.status).toBe("failed");
    } finally {
      db.close();
    }
  });

  it("retries only an explicit transient error and records a successful Page post", async () => {
    const db = fixture();
    try {
      const repository = new D1SocialPostRepository(localD1(db));
      const { post } = await repository.createFacebookQueued({
        storyId: "story-2", storyVersionId: "version-2", postText: "Fresh article",
        canonicalUrl: "https://mso24.hu/hir/fresh-article-2",
      });
      await repository.claimFacebookForPosting(post.id);
      await repository.markFailed(post.id, "facebook_temporary_error", "HTTP 503");
      expect((await repository.claimFacebookForPosting(post.id))?.attemptCount).toBe(2);
      await repository.markPosted(post.id, "page_123");
      expect(await repository.claimFacebookForPosting(post.id)).toBeNull();
      expect((await repository.getById(post.id))?.externalPostId).toBe("page_123");
      const metrics = await repository.getFacebookMetricsSince(new Date(Date.now() - 60_000));
      expect(metrics.posted24h).toBe(1);
      expect(metrics.lastExternalPostId).toBe("page_123");
    } finally {
      db.close();
    }
  });

  it("filters old pending intents in SQL so they cannot starve new posts", async () => {
    const db = fixture();
    try {
      const repository = new D1SocialPostRepository(localD1(db));
      const old = await repository.createFacebookQueued({
        storyId: "old", storyVersionId: "old-version", postText: "Old",
        canonicalUrl: "https://mso24.hu/hir/old",
      });
      db.prepare("UPDATE social_posts SET created_at = ? WHERE id = ?")
        .run("2026-09-15T20:29:59.000000+00:00", old.post.id);
      const fresh = await repository.createFacebookQueued({
        storyId: "fresh", storyVersionId: "fresh-version", postText: "Fresh",
        canonicalUrl: "https://mso24.hu/hir/fresh",
      });
      expect((await repository.listPendingFacebookEnqueue(1,
        new Date("2026-09-15T20:30:00.000Z"))).map(post => post.id)).toEqual([fresh.post.id]);
    } finally {
      db.close();
    }
  });
});
