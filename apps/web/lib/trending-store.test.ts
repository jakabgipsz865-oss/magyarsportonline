import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { TABLOID_PUBLIC_PROMPT } from "@magyarsportonline/shared";
import type { D1Client, D1Statement } from "@magyarsportonline/db/d1";
import { readTrendingSnapshot, recordQualifiedRead, refreshTrending } from "./trending-store";
import { pickTrending } from "./trending";
import { runCron } from "../../ingest-scheduler/src/index";
import { vi } from "vitest";

const { DatabaseSync: SQLiteDatabase } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

function d1Adapter(sqlite: DatabaseSync): D1Client {
  return {
    prepare(sql: string): D1Statement {
      const statement = sqlite.prepare(sql);
      let values: Array<string | number | null> = [];
      const adapter: D1Statement = {
        bind(...next) {
          values = next.map((value) => (typeof value === "boolean" ? Number(value) : value));
          return adapter;
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
      return adapter;
    },
  };
}

function setup() {
  const sqlite = new SQLiteDatabase(":memory:");
  sqlite.exec("CREATE TABLE stories (id TEXT PRIMARY KEY, status TEXT NOT NULL)");
  sqlite.exec("INSERT INTO stories VALUES ('public-story','published'), ('private-story','draft')");
  sqlite.exec(`CREATE TABLE story_read_model (
    story_id TEXT PRIMARY KEY, slug TEXT NOT NULL, published_at TEXT NOT NULL,
    version_history_summary TEXT NOT NULL, image_url TEXT,
    title_hu TEXT NOT NULL DEFAULT 'Hír', body_html TEXT NOT NULL DEFAULT '<p>Hír.</p>'
  )`);
  sqlite.exec(
    readFileSync(
      new URL("../../../packages/db/d1/0002_qualified_read_trending.sql", import.meta.url),
      "utf8",
    ),
  );
  const current = JSON.stringify([{ prompt_version: TABLOID_PUBLIC_PROMPT, is_current: true }]);
  sqlite
    .prepare(
      "INSERT INTO story_read_model (story_id, slug, published_at, version_history_summary, image_url) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      "public-story",
      "public-story",
      "2026-09-29T10:00:00.000000+00:00",
      current,
      "https://example.com/photo.jpg",
    );
  sqlite
    .prepare(
      "INSERT INTO story_read_model (story_id, slug, published_at, version_history_summary, image_url) VALUES (?, ?, ?, ?, ?)",
    )
    .run("private-story", "private-story", "2026-09-29T10:00:00.000000+00:00", "[]", null);
  return { sqlite, db: d1Adapter(sqlite) };
}

describe("D1 qualified-read migration and ranking", () => {
  it("scheduler integration changes refreshedAt for 15 minutes without stale snapshots or AI", async () => {
    const { sqlite, db } = setup();
    let time = new Date("2026-09-29T12:00:00Z");
    for (let i = 0; i < 5; i++)
      await recordQualifiedRead(db, {
        eventId: `read-${i}`,
        storyId: "public-story",
        source: "direct",
        now: time,
      });
    const refreshes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(init?.headers).toEqual({ authorization: "Bearer integration-secret" });
        expect(String(url).startsWith("https://preview.example/")).toBe(true);
        if (String(url).endsWith("/api/internal/trending")) {
          const snapshot = await refreshTrending(db, time);
          refreshes.push(snapshot.refreshedAt);
          return Response.json({ refreshedAt: snapshot.refreshedAt });
        }
        return Response.json({ processed: 0 });
      }),
    );
    try {
      for (let minute = 0; minute <= 15; minute += 5) {
        time = new Date(`2026-09-29T12:${String(minute).padStart(2, "0")}:00Z`);
        await runCron(
          { APP_ORIGIN: "https://preview.example", CRON_SECRET: "integration-secret" },
          time,
        );
        expect(pickTrending(await readTrendingSnapshot(db), time).heroId).toBe("public-story");
      }
      expect(new Set(refreshes).size).toBe(4);
      sqlite.prepare("UPDATE stories SET status='withdrawn' WHERE id='public-story'").run();
      expect(pickTrending(await readTrendingSnapshot(db), time).heroId).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      sqlite.close();
    }
  });
  it("accepts only public stories and atomically deduplicates retries", async () => {
    const { sqlite, db } = setup();
    const now = new Date("2026-09-29T12:04:00.000Z");
    const eventId = "123e4567-e89b-42d3-a456-426614174000";
    expect(
      await recordQualifiedRead(db, { eventId, storyId: "public-story", source: "latest", now }),
    ).toBe(true);
    expect(
      await recordQualifiedRead(db, { eventId, storyId: "public-story", source: "latest", now }),
    ).toBe(false);
    expect(
      await recordQualifiedRead(db, {
        eventId: "123e4567-e89b-42d3-a456-426614174001",
        storyId: "private-story",
        source: "latest",
        now,
      }),
    ).toBe(false);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM qualified_read_events").get()).toMatchObject({
      n: 1,
    });
    expect(
      sqlite.prepare("SELECT normal_reads, promoted_reads FROM qualified_read_buckets").get(),
    ).toMatchObject({ normal_reads: 1, promoted_reads: 0 });
    sqlite.close();
  });

  it("counts promoted reads separately and persists a moving-window snapshot", async () => {
    const { sqlite, db } = setup();
    const now = new Date("2026-09-29T12:04:00.000Z");
    for (let index = 0; index < 5; index++) {
      await recordQualifiedRead(db, {
        eventId: `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`,
        storyId: "public-story",
        source: index === 4 ? "trending_hero" : "search",
        now,
      });
    }
    const result = await refreshTrending(db, now);
    expect(result.ranking[0]).toMatchObject({
      storyId: "public-story",
      hasImage: true,
      normal1h: 4,
      promoted1h: 1,
      normal24h: 4,
      promoted24h: 1,
      score: 34,
    });
    expect((await readTrendingSnapshot(db))?.ranking[0]?.score).toBe(34);
    sqlite.close();
  });
});
