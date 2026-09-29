import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { D1StoryReadModelRepository } from "./story-read-model-repository";
import type { D1Client, D1Statement } from "./client";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

function localD1(db: DatabaseSyncType): D1Client {
  return {
    prepare(query): D1Statement {
      const statement = db.prepare(query);
      let values: (string | number | null)[] = [];
      return {
        bind(...input) {
          values = input.map((value) => (typeof value === "boolean" ? Number(value) : value));
          return this;
        },
        async first<T>() {
          return (statement.get(...values) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: statement.all(...values) as T[] };
        },
        async run() {
          return { meta: { changes: Number(statement.run(...values).changes) } };
        },
      };
    },
  };
}

function fixture(): DatabaseSyncType {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE story_read_model (
    story_id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL,
    title_hu TEXT NOT NULL, lead_hu TEXT NOT NULL, body_html TEXT NOT NULL,
    image_url TEXT, inline_images TEXT NOT NULL, is_ai_generated INTEGER NOT NULL,
    meta_description TEXT, structured_data TEXT, sources_summary TEXT NOT NULL,
    tags TEXT NOT NULL, category TEXT, confidence_score TEXT,
    is_developing INTEGER NOT NULL, published_at TEXT NOT NULL,
    last_updated_at TEXT NOT NULL, version_history_summary TEXT NOT NULL,
    credibility_summary TEXT
  )`);
  return db;
}

const row = {
  storyId: "story-1",
  slug: "friss-hir",
  titleHu: "Friss hír",
  leadHu: "Bevezető",
  bodyHtml: "<p>Törzs</p>",
  imageUrl: null,
  inlineImages: [],
  isAiGenerated: true,
  metaDescription: null,
  structuredData: { headline: "Friss hír" },
  sourcesSummary: [
    { name: "Source", url: "https://example.com", firstSeenAt: "2026-09-27T18:00:00Z" },
  ],
  tags: [],
  category: null,
  confidenceScore: "0.880",
  isDeveloping: false,
  publishedAt: new Date("2026-09-27T18:25:35Z"),
  lastUpdatedAt: new Date("2026-09-27T18:25:35Z"),
  versionHistorySummary: [{ prompt_version: "tabloid-hu@2", is_current: true }],
  credibilitySummary: null,
};

describe("D1 public read model", () => {
  it("preserves public filtering, JSON, timestamps, upsert and deletion", async () => {
    const db = fixture();
    try {
      const repository = new D1StoryReadModelRepository(localD1(db));
      await repository.upsert(row);
      await repository.upsert({ ...row, titleHu: "Módosított cím" });
      expect(
        (db.prepare("SELECT count(*) AS n FROM story_read_model").get() as { n: number }).n,
      ).toBe(1);
      const found = await repository.getBySlug(row.slug);
      expect(found?.titleHu).toBe("Módosított cím");
      expect(found?.publishedAt.toISOString()).toBe(row.publishedAt.toISOString());
      expect(found?.sourcesSummary).toEqual(row.sourcesSummary);
      expect(
        (await repository.listPublished({ limit: 10, offset: 0 })).map((item) => item.storyId),
      ).toEqual([row.storyId]);
      expect(await repository.countPublished()).toBe(1);

      await repository.upsert({
        ...row,
        versionHistorySummary: [{ prompt_version: "other", is_current: true }],
      });
      expect(await repository.getBySlug(row.slug)).toBeNull();
      expect(await repository.listPublished({ limit: 10, offset: 0 })).toEqual([]);
      expect(await repository.countPublished()).toBe(0);
      await repository.deleteByStoryId(row.storyId);
      expect(
        (db.prepare("SELECT count(*) AS n FROM story_read_model").get() as { n: number }).n,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  it("covers more than one archive page without duplicate or hidden stories", async () => {
    const db = fixture();
    try {
      const repository = new D1StoryReadModelRepository(localD1(db));
      for (let index = 1; index <= 81; index++) {
        await repository.upsert({
          ...row,
          storyId: `story-${index}`,
          slug: `hir-${index}`,
          publishedAt: new Date(row.publishedAt.getTime() + index * 1000),
        });
      }
      await repository.upsert({
        ...row,
        storyId: "hidden-story",
        slug: "hidden-story",
        versionHistorySummary: [{ prompt_version: "other", is_current: true }],
      });

      expect(await repository.countPublished()).toBe(81);
      const pages = await Promise.all(
        [0, 40, 80].map((offset) => repository.listPublished({ limit: 40, offset })),
      );
      expect(pages.map((page) => page.length)).toEqual([40, 40, 1]);
      const ids = pages.flat().map((item) => item.storyId);
      expect(new Set(ids).size).toBe(81);
      expect(ids).not.toContain("hidden-story");
      expect(ids[0]).toBe("story-81");
      expect(ids.at(-1)).toBe("story-1");
    } finally {
      db.close();
    }
  });
});
