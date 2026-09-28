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

function localD1(
  db: DatabaseSyncType,
  onBind?: (query: string, values: readonly unknown[]) => void,
): D1Client {
  const batched = new WeakMap<D1Statement, () => { meta: { changes: number } }>();
  return {
    prepare(query): D1Statement {
      const statement = db.prepare(query);
      let values: (string | number | null)[] = [];
      const bound: D1Statement = {
        bind(...input) {
          onBind?.(query, input);
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
      batched.set(bound, () => ({ meta: { changes: Number(statement.run(...values).changes) } }));
      return bound;
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = statements.map((statement) => {
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
  it.each([0, 30, 99, 100, 150, 200, 201])(
    "keeps every URL and the D1 parameter limit for a %i-item feed",
    async (size) => {
      const db = new DatabaseSync(":memory:");
      try {
        db.exec(readFileSync(new URL("../../d1/0001_initial.sql", import.meta.url), "utf8"));
        const sourceId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO sources (id,name,base_url,type,language,license_type,
          reliability_tier,fetch_config,is_active,polling_frequency_minutes)
          VALUES (?,?,?,'rss','en','public_rss','C',?,1,1)`,
        ).run(sourceId, "Boundary feed", "https://example.com", JSON.stringify({ tabloid: true }));
        const binds: Array<{ query: string; values: readonly unknown[] }> = [];
        const raw = new D1RawArticleIngestRepository(
          localD1(db, (query, values) => {
            if (query.includes("SELECT source_url FROM raw_articles")) {
              binds.push({ query, values });
            }
          }),
        );
        const urls = Array.from({ length: size }, (_, index) => `https://example.com/${index}`);
        const receiptFor = (sourceUrl: string) => ({
          sourceId,
          sourceUrl,
          titleOriginal: "Football story",
          bodyOriginal: "RSS summary",
          language: "en",
          contentOrigin: "rss_snippet" as const,
        });
        const seeded = new Set<string>();
        for (let index = 0; index < urls.length; index += 2) {
          const url = urls[index]!;
          expect((await raw.insertTabloid(receiptFor(url), false))?.id).toBeTruthy();
          seeded.add(url);
        }

        expect(await raw.existingSourceUrls(sourceId, urls)).toEqual(seeded);
        expect(binds).toHaveLength(Math.ceil(size / 99));
        expect(binds.flatMap(({ values }) => values.slice(1))).toEqual(urls);
        for (const { query, values } of binds) {
          expect(values[0]).toBe(sourceId);
          expect(values.length).toBeLessThanOrEqual(100);
          expect(query.match(/\?/g)).toHaveLength(values.length);
        }

        for (const url of urls) {
          if (!seeded.has(url)) {
            expect((await raw.insertTabloid(receiptFor(url), false))?.id).toBeTruthy();
          }
        }
        expect(await raw.existingSourceUrls(sourceId, urls)).toEqual(new Set(urls));
        expect(
          (db.prepare("SELECT COUNT(*) AS count FROM raw_articles").get() as { count: number })
            .count,
        ).toBe(size);
        if (urls.length > 0) {
          expect(await raw.insertTabloid(receiptFor(urls.at(-1)!), false)).toBeNull();
          expect(
            (db.prepare("SELECT COUNT(*) AS count FROM raw_articles").get() as { count: number })
              .count,
          ).toBe(size);
        }
      } finally {
        db.close();
      }
    },
  );

  it("deduplicates feed receipts and atomically upgrades only the current fetch claim", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(readFileSync(new URL("../../d1/0001_initial.sql", import.meta.url), "utf8"));
      const sourceId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO sources (id,name,base_url,type,language,license_type,
        reliability_tier,fetch_config,is_active,polling_frequency_minutes)
        VALUES (?,?,?,'rss','en','public_rss','C',?,1,1)`,
      ).run(sourceId, "Test Source", "https://example.com", JSON.stringify({ tabloid: true }));
      const binding = localD1(db);
      const sources = new D1SourceIngestRepository(binding);
      const raw = new D1RawArticleIngestRepository(binding);
      expect((await sources.listActive()).map((source) => source.id)).toEqual([sourceId]);

      const receipt = {
        sourceId,
        sourceUrl: "https://example.com/story-1",
        titleOriginal: "Football story",
        bodyOriginal: "RSS summary",
        language: "en",
        extractedEntities: { rssGuid: "guid-1" },
        rssGuid: "guid-1",
        contentOrigin: "rss_snippet" as const,
        publishedAtSource: new Date("2026-09-28T11:59:00Z"),
        firstSeenAt: new Date("2026-09-28T12:00:00Z"),
        processingStatus: "awaiting_full_article",
        processingAvailableAt: new Date("2026-09-28T12:00:00Z"),
      };
      const inserted = await raw.insertTabloid(receipt, false);
      expect(inserted?.id).toBeTruthy();
      expect(
        await raw.existingSourceUrls(sourceId, [receipt.sourceUrl, "https://example.com/new"]),
      ).toEqual(new Set([receipt.sourceUrl]));
      expect(await raw.insertTabloid(receipt, false)).toBeNull();
      const historical = await raw.insertTabloid(
        {
          ...receipt,
          sourceUrl: "https://example.com/historical",
          rssGuid: "old-guid",
          extractedEntities: { rssGuid: "old-guid" },
          firstSeenAt: new Date("2026-09-01T12:00:00Z"),
        },
        false,
      );
      expect(historical?.id).toBeTruthy();
      const staleOnFirstFetch = await raw.insertTabloid(
        {
          ...receipt,
          sourceUrl: "https://example.com/stale-feed-item",
          rssGuid: "stale-guid",
          extractedEntities: { rssGuid: "stale-guid" },
          publishedAtSource: new Date("2026-09-27T10:00:00Z"),
        },
        false,
      );
      expect(staleOnFirstFetch?.id).toBeTruthy();
      const [claim] = await raw.claimTabloidFetchBatch(
        [sourceId],
        1,
        300_000,
        new Date("2026-09-28T12:01:00Z"),
        new Date("2026-09-28T00:00:00Z"),
      );
      expect(claim?.id).toBe(inserted?.id);
      expect(claim?.processingOwner).toBeTruthy();
      if (!claim) throw new Error("Expected an RSS receipt claim");
      expect(
        (
          db
            .prepare("SELECT processing_status FROM raw_articles WHERE id=?")
            .get(historical!.id) as { processing_status: string }
        ).processing_status,
      ).toBe("awaiting_full_article");
      expect(
        (
          db
            .prepare("SELECT processing_status FROM raw_articles WHERE id=?")
            .get(staleOnFirstFetch!.id) as { processing_status: string }
        ).processing_status,
      ).toBe("awaiting_full_article");

      const complete = {
        sourceUrl: receipt.sourceUrl,
        titleOriginal: receipt.titleOriginal,
        bodyOriginal: "The full football article",
        subtitleOriginal: null,
        authorOriginal: null,
        publishedAtSource: new Date("2026-09-28T11:59:00Z"),
        imageUrl: null,
        inlineImages: [],
      };
      expect(await raw.upgradeAndEnqueueTabloid(claim.id, complete, "wrong-owner")).toBe(false);
      expect(await raw.upgradeAndEnqueueTabloid(claim.id, complete, claim.processingOwner!)).toBe(
        true,
      );
      expect(await raw.upgradeAndEnqueueTabloid(claim.id, complete, claim.processingOwner!)).toBe(
        false,
      );
      const saved = db
        .prepare(
          "SELECT content_origin, body_original, processing_status, processing_owner FROM raw_articles WHERE id=?",
        )
        .get(claim.id) as Record<string, unknown>;
      expect(saved).toMatchObject({
        content_origin: "full_article",
        body_original: complete.bodyOriginal,
        processing_status: "queued",
        processing_owner: null,
      });
      const jobs = db.prepare("SELECT event, status FROM pipeline_jobs").all() as Array<{
        event: string;
        status: string;
      }>;
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.status).toBe("pending");
      expect(JSON.parse(jobs[0]!.event).payload.raw_article_id).toBe(claim.id);
      const misleadingFeedDate = await raw.insertTabloid(
        {
          ...receipt,
          sourceUrl: "https://example.com/misdated",
          rssGuid: "misdated-guid",
          extractedEntities: { rssGuid: "misdated-guid" },
          publishedAtSource: new Date("2026-09-28T12:00:30Z"),
        },
        false,
      );
      const [misdatedClaim] = await raw.claimTabloidFetchBatch(
        [sourceId],
        1,
        300_000,
        new Date("2026-09-28T12:01:30Z"),
        new Date("2026-09-28T12:00:00Z"),
      );
      expect(misdatedClaim?.id).toBe(misleadingFeedDate?.id);
      expect(
        await raw.upgradeAndEnqueueTabloid(
          misdatedClaim!.id,
          {
            ...complete,
            sourceUrl: "https://example.com/misdated",
            publishedAtSource: new Date("2026-09-28T11:58:00Z"),
          },
          misdatedClaim!.processingOwner!,
          new Date("2026-09-28T12:00:00Z"),
        ),
      ).toBe(false);
      expect(db.prepare("SELECT COUNT(*) AS n FROM pipeline_jobs").get()).toMatchObject({ n: 1 });
      expect(
        db
          .prepare(
            "SELECT processing_status, decision_reason, content_origin FROM raw_articles WHERE id=?",
          )
          .get(misdatedClaim!.id),
      ).toMatchObject({
        processing_status: "historical_before_activation",
        decision_reason: "full_article_published_before_activation",
        content_origin: "full_article",
      });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      await sources.recordFetchResult(sourceId, {
        status: "ok",
        fetchedAt: new Date("2026-09-28T12:02:00Z"),
      });
      expect(await sources.listActive(new Date("2026-09-28T12:02:30Z"))).toEqual([]);
      // A one-minute feed is eligible on the next minute boundary even when
      // the previous fetch completed partway through its minute.
      expect(
        (await sources.listActive(new Date("2026-09-28T12:03:00Z"))).map((source) => source.id),
      ).toEqual([sourceId]);
      expect(
        (await sources.listActive(new Date("2026-09-28T12:04:00Z"))).map((source) => source.id),
      ).toEqual([sourceId]);
    } finally {
      db.close();
    }
  });
});
