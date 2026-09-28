import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { D1RawArticleIngestRepository } from "./raw-article-ingest-repository";
import { D1SourceIngestRepository } from "./source-ingest-repository";
import type { D1Client, D1Statement } from "./client";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

function localD1(db: DatabaseSyncType): D1Client {
  const batched = new WeakMap<D1Statement, () => { meta: { changes: number } }>();
  return {
    prepare(query): D1Statement {
      const statement = db.prepare(query);
      let values: (string | number | null)[] = [];
      const bound: D1Statement = {
        bind(...input) { values = input.map(value => typeof value === "boolean" ? Number(value) : value); return this; },
        async first<T>() { return (statement.get(...values) as T | undefined) ?? null; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
      };
      batched.set(bound, () => ({ meta: { changes: Number(statement.run(...values).changes) } }));
      return bound;
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = statements.map(statement => {
          const run = batched.get(statement);
          if (!run) throw new Error("Unknown D1 statement");
          return run();
        });
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

describe("D1 RSS receipt and full-article job", () => {
  it("deduplicates feed receipts and atomically upgrades only the current fetch claim", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(readFileSync(new URL("../../d1/0001_initial.sql", import.meta.url), "utf8"));
      const sourceId = crypto.randomUUID();
      db.prepare(`INSERT INTO sources (id,name,base_url,type,language,license_type,
        reliability_tier,fetch_config,is_active,polling_frequency_minutes)
        VALUES (?,?,?,'rss','en','public_rss','C',?,1,1)`)
        .run(sourceId, "Test Source", "https://example.com", JSON.stringify({ tabloid: true }));
      const binding = localD1(db);
      const sources = new D1SourceIngestRepository(binding);
      const raw = new D1RawArticleIngestRepository(binding);
      expect((await sources.listActive()).map(source => source.id)).toEqual([sourceId]);

      const receipt = {
        sourceId, sourceUrl: "https://example.com/story-1", titleOriginal: "Football story",
        bodyOriginal: "RSS summary", language: "en", extractedEntities: { rssGuid: "guid-1" },
        rssGuid: "guid-1", contentOrigin: "rss_snippet" as const,
        firstSeenAt: new Date("2026-09-28T12:00:00Z"),
        processingStatus: "awaiting_full_article",
        processingAvailableAt: new Date("2026-09-28T12:00:00Z"),
      };
      const inserted = await raw.insertTabloid(receipt, false);
      expect(inserted?.id).toBeTruthy();
      expect(await raw.insertTabloid(receipt, false)).toBeNull();
      const historical = await raw.insertTabloid({
        ...receipt, sourceUrl: "https://example.com/historical", rssGuid: "old-guid",
        extractedEntities: { rssGuid: "old-guid" },
        firstSeenAt: new Date("2026-09-01T12:00:00Z"),
      }, false);
      expect(historical?.id).toBeTruthy();
      const [claim] = await raw.claimTabloidFetchBatch([sourceId], 1, 300_000,
        new Date("2026-09-28T12:01:00Z"), new Date("2026-09-28T00:00:00Z"));
      expect(claim?.id).toBe(inserted?.id);
      expect(claim?.processingOwner).toBeTruthy();
      if (!claim) throw new Error("Expected an RSS receipt claim");
      expect((db.prepare("SELECT processing_status FROM raw_articles WHERE id=?")
        .get(historical!.id) as { processing_status: string }).processing_status)
        .toBe("awaiting_full_article");

      const complete = {
        sourceUrl: receipt.sourceUrl, titleOriginal: receipt.titleOriginal,
        bodyOriginal: "The full football article", subtitleOriginal: null,
        authorOriginal: null, publishedAtSource: new Date("2026-09-28T11:59:00Z"),
        imageUrl: null, inlineImages: [],
      };
      expect(await raw.upgradeAndEnqueueTabloid(claim.id, complete, "wrong-owner")).toBe(false);
      expect(await raw.upgradeAndEnqueueTabloid(claim.id, complete, claim.processingOwner!)).toBe(true);
      expect(await raw.upgradeAndEnqueueTabloid(claim.id, complete, claim.processingOwner!)).toBe(false);
      const saved = db.prepare("SELECT content_origin, body_original, processing_status, processing_owner FROM raw_articles WHERE id=?")
        .get(claim.id) as Record<string, unknown>;
      expect(saved).toMatchObject({ content_origin: "full_article",
        body_original: complete.bodyOriginal, processing_status: "queued", processing_owner: null });
      const jobs = db.prepare("SELECT event, status FROM pipeline_jobs").all() as Array<{ event: string; status: string }>;
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.status).toBe("pending");
      expect(JSON.parse(jobs[0]!.event).payload.raw_article_id).toBe(claim.id);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      await sources.recordFetchResult(sourceId, { status: "ok", fetchedAt: new Date("2026-09-28T12:02:00Z") });
      expect(await sources.listActive(new Date("2026-09-28T12:02:30Z"))).toEqual([]);
      // A one-minute feed is eligible on the next minute boundary even when
      // the previous fetch completed partway through its minute.
      expect((await sources.listActive(new Date("2026-09-28T12:03:00Z"))).map(source => source.id))
        .toEqual([sourceId]);
      expect((await sources.listActive(new Date("2026-09-28T12:04:00Z"))).map(source => source.id))
        .toEqual([sourceId]);
    } finally {
      db.close();
    }
  });
});
