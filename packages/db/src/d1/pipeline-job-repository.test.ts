import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { D1Client, D1Statement } from "./client";
import { D1PipelineJobRepository } from "./pipeline-job-repository";

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
    CREATE TABLE pipeline_jobs (
      id TEXT PRIMARY KEY, event TEXT NOT NULL CHECK (json_valid(event)),
      status TEXT NOT NULL, attempts INTEGER NOT NULL,
      max_attempts INTEGER NOT NULL, available_at TEXT NOT NULL,
      locked_at TEXT, claim_owner TEXT, claim_version INTEGER NOT NULL,
      last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX pipeline_jobs_status_available_at_idx
      ON pipeline_jobs (status, available_at);
  `);
  return db;
}

describe("D1 pipeline job fencing", () => {
  it("deduplicates an active business event despite a different envelope ID", async () => {
    const db = fixture();
    try {
      const jobs = new D1PipelineJobRepository(localD1(db));
      await jobs.enqueue({ id: "envelope-a", type: "story.ready", payload: { storyId: "s1" } });
      await jobs.enqueue({ id: "envelope-b", type: "story.ready", payload: { storyId: "s1" } });
      await jobs.enqueue({ id: "envelope-c", type: "story.ready", payload: { storyId: "s2" } });
      expect((db.prepare("SELECT count(*) AS n FROM pipeline_jobs").get() as { n: number }).n).toBe(2);
      expect((await jobs.getStatusCounts()).pending).toBe(2);
    } finally {
      db.close();
    }
  });

  it("reclaims an expired claim and fences the old worker from completing it", async () => {
    const db = fixture();
    try {
      const jobs = new D1PipelineJobRepository(localD1(db));
      await jobs.enqueue({ type: "story.ready", payload: { storyId: "s1" } });
      const first = (await jobs.claimBatch(1, 60_000, new Date(Date.now() + 1000)))[0]!;
      expect(first.claimVersion).toBe(1);
      expect(await jobs.claimBatch(1, 60_000, new Date(Date.now() + 2000))).toEqual([]);

      db.prepare("UPDATE pipeline_jobs SET locked_at=? WHERE id=?")
        .run("2020-01-01T00:00:00.000000+00:00", first.id);
      const second = (await jobs.claimBatch(1, 60_000, new Date(Date.now() + 3000)))[0]!;
      expect(second.claimVersion).toBe(2);
      expect(second.claimOwner).not.toBe(first.claimOwner);
      expect(await jobs.complete(first.id, first.claimOwner!)).toBe(false);
      expect(await jobs.complete(second.id, second.claimOwner!)).toBe(true);
      expect((await jobs.getStatusCounts()).completed).toBe(1);
    } finally {
      db.close();
    }
  });

  it("leaves imported historical jobs dormant behind the D1 activation boundary", async () => {
    const db = fixture();
    try {
      const jobs = new D1PipelineJobRepository(localD1(db));
      await jobs.enqueue({ type: "source/article.ingested", payload: { raw_article_id: "historical" } });
      await jobs.enqueue({ type: "source/article.ingested", payload: { raw_article_id: "fresh" } });
      db.prepare(`UPDATE pipeline_jobs SET created_at='2026-09-01T00:00:00.000000+00:00'
        WHERE json_extract(event, '$.payload.raw_article_id')='historical'`).run();
      const boundary = new Date(Date.now() - 60_000);
      expect((await jobs.getStatusCounts(new Date(), boundary)).pending).toBe(1);
      const claimed = await jobs.claimBatch(2, 60_000, new Date(Date.now() + 1000), boundary);
      expect(claimed).toHaveLength(1);
      expect((claimed[0]?.event as { payload: { raw_article_id: string } }).payload.raw_article_id)
        .toBe("fresh");
      expect((db.prepare(`SELECT status FROM pipeline_jobs
        WHERE json_extract(event, '$.payload.raw_article_id')='historical'`).get() as { status: string }).status)
        .toBe("pending");
    } finally {
      db.close();
    }
  });

  it("limits dead-letter diagnostics and manual recovery to post-cutover jobs", async () => {
    const db = fixture();
    try {
      const jobs = new D1PipelineJobRepository(localD1(db));
      await jobs.enqueue({ type: "source/article.ingested", payload: { raw_article_id: "historical" } });
      await jobs.enqueue({ type: "source/article.ingested", payload: { raw_article_id: "fresh" } });
      db.prepare(`UPDATE pipeline_jobs SET status='dead_letter', last_error='fixture',
        created_at='2026-09-01T00:00:00.000000+00:00'
        WHERE json_extract(event, '$.payload.raw_article_id')='historical'`).run();
      db.prepare(`UPDATE pipeline_jobs SET status='dead_letter', last_error='fixture'
        WHERE json_extract(event, '$.payload.raw_article_id')='fresh'`).run();
      const boundary = new Date(Date.now() - 60_000);
      expect(await jobs.getDeadLetterSummary(20, boundary)).toMatchObject([
        { eventType: "source/article.ingested", count: 1 },
      ]);
      expect(await jobs.requeueDeadLetters(10, boundary)).toBe(1);
      expect((db.prepare(`SELECT status FROM pipeline_jobs
        WHERE json_extract(event, '$.payload.raw_article_id')='historical'`).get() as { status: string }).status)
        .toBe("dead_letter");
      expect((await jobs.getStatusCounts(new Date(), boundary)).pending).toBe(1);
    } finally {
      db.close();
    }
  });
});
