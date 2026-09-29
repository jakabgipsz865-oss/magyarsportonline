import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { TABLOID_PUBLIC_PROMPT } from "@magyarsportonline/shared";
import type { D1Client, D1Statement } from "@magyarsportonline/db/d1";
import { readTrendingSnapshot, recordQualifiedRead, refreshTrending } from "./trending-store";

const { DatabaseSync: SQLiteDatabase } = createRequire(import.meta.url)("node:sqlite") as
  typeof import("node:sqlite");

function d1Adapter(sqlite: DatabaseSync): D1Client {
  return {
    prepare(sql: string): D1Statement {
      const statement = sqlite.prepare(sql);
      let values: Array<string | number | null> = [];
      const adapter: D1Statement = {
        bind(...next) { values = next.map((value) => typeof value === "boolean" ? Number(value) : value); return adapter; },
        async first<T>() { return (statement.get(...values) as T | undefined) ?? null; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
      };
      return adapter;
    },
  };
}

function setup() {
  const sqlite = new SQLiteDatabase(":memory:");
  sqlite.exec(`CREATE TABLE story_read_model (
    story_id TEXT PRIMARY KEY, slug TEXT NOT NULL, published_at TEXT NOT NULL,
    version_history_summary TEXT NOT NULL, image_url TEXT
  )`);
  sqlite.exec(readFileSync(new URL("../../../packages/db/d1/0002_qualified_read_trending.sql", import.meta.url), "utf8"));
  const current = JSON.stringify([{ prompt_version: TABLOID_PUBLIC_PROMPT, is_current: true }]);
  sqlite.prepare("INSERT INTO story_read_model VALUES (?, ?, ?, ?, ?)")
    .run("public-story", "public-story", "2026-09-29T10:00:00.000000+00:00", current, "https://example.com/photo.jpg");
  sqlite.prepare("INSERT INTO story_read_model VALUES (?, ?, ?, ?, ?)")
    .run("private-story", "private-story", "2026-09-29T10:00:00.000000+00:00", "[]", null);
  return { sqlite, db: d1Adapter(sqlite) };
}

describe("D1 qualified-read migration and ranking", () => {
  it("accepts only public stories and atomically deduplicates retries", async () => {
    const { sqlite, db } = setup();
    const now = new Date("2026-09-29T12:04:00.000Z");
    const eventId = "123e4567-e89b-42d3-a456-426614174000";
    expect(await recordQualifiedRead(db, { eventId, storyId: "public-story", source: "latest", now }))
      .toBe(true);
    expect(await recordQualifiedRead(db, { eventId, storyId: "public-story", source: "latest", now }))
      .toBe(false);
    expect(await recordQualifiedRead(db, {
      eventId: "123e4567-e89b-42d3-a456-426614174001", storyId: "private-story",
      source: "latest", now,
    })).toBe(false);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM qualified_read_events").get()).toMatchObject({ n: 1 });
    expect(sqlite.prepare("SELECT normal_reads, promoted_reads FROM qualified_read_buckets").get())
      .toMatchObject({ normal_reads: 1, promoted_reads: 0 });
    sqlite.close();
  });

  it("counts promoted reads separately and persists a moving-window snapshot", async () => {
    const { sqlite, db } = setup();
    const now = new Date("2026-09-29T12:04:00.000Z");
    for (let index = 0; index < 5; index++) {
      await recordQualifiedRead(db, {
        eventId: `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`,
        storyId: "public-story", source: index === 4 ? "trending_hero" : "search", now,
      });
    }
    const result = await refreshTrending(db, now);
    expect(result.ranking[0]).toMatchObject({
      storyId: "public-story", hasImage: true, normal1h: 4, promoted1h: 1,
      normal24h: 4, promoted24h: 1, score: 34,
    });
    expect((await readTrendingSnapshot(db))?.ranking[0]?.score).toBe(34);
    sqlite.close();
  });
});
