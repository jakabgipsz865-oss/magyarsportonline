import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env["CRON_SECRET"] ??= "d1-job-test-only";
});
import type { D1Client, D1Statement } from "@magyarsportonline/db/d1";
import {
  D1LlmUsageRepository,
  D1PipelineJobRepository,
  D1RawArticleIngestRepository,
  D1StoryReadModelRepository,
} from "@magyarsportonline/db/d1";
import type { LlmClient } from "@magyarsportonline/llm";
import { DailyRequestCappedLlmClient, GeminiApiError } from "@magyarsportonline/llm";
import { loadWriterHealth } from "./writer-health";
import { tabloid } from "@magyarsportonline/agents";
import { processOneD1Job } from "./d1-job-process";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};
const SOURCE_ID = "19294270-000c-597d-9c68-d6ad9c5e8950";

function fixture(): { db: DatabaseSyncType; d1: D1Client } {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(new URL("../../../packages/db/d1/0001_initial.sql", import.meta.url), "utf8"),
  );
  db.exec(
    readFileSync(new URL("../../../packages/db/d1/0004_language_qa.sql", import.meta.url), "utf8"),
  );
  db.exec("PRAGMA foreign_keys=ON");
  db.prepare(
    `INSERT INTO sources (id,name,base_url,type,language,license_type,
    reliability_tier,fetch_config,is_active)
    VALUES (?,?,?,'rss','en','public_rss','C',?,1)`,
  ).run(
    SOURCE_ID,
    "Test football feed",
    "https://example.com",
    JSON.stringify({ tabloid: true, footballFeed: true, mode: "BROAD_TABLOID_FOOTBALL" }),
  );
  const batched = new WeakMap<D1Statement, () => { meta: { changes: number } }>();
  const d1: D1Client = {
    prepare(query) {
      const statement = db.prepare(query);
      let values: (string | number | null)[] = [];
      const bound: D1Statement = {
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
  return { db, d1 };
}

function writer() {
  const completeJson = vi.fn(async () => ({
    data: {
      title_hu: "Az Arsenal új játékossal erősített",
      lead_hu: "Az angol klub közölte az új labdarúgó érkezését.",
      body_hu:
        "Az Arsenal bejelentette, hogy új játékossal erősítette meg a keretét. A klub közlése szerint az érkező labdarúgó csatlakozott a csapathoz.",
      language_warnings: [],
    },
    inputTokens: 100,
    outputTokens: 80,
    modelLabel: "mock-writer",
  }));
  return {
    client: { completeJson, modelLabel: "mock-writer" } as unknown as LlmClient,
    completeJson,
  };
}

describe("D1 full article publication", () => {
  it("never repeats a paid successful Writer call when saving its response failed", async () => {
    const { db, d1 } = fixture();
    try {
      const now = new Date();
      const rawId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO raw_articles(id,source_id,source_url,title_original,body_original,language,content_origin,inline_images,extracted_entities,first_seen_at)
        VALUES(?,?,?,?,?,'en','full_article','[]','{}',?)`,
      ).run(
        rawId,
        SOURCE_ID,
        "https://example.com/football-save-failure",
        "Arsenal announces football signing",
        "Arsenal announced a new football signing. The club said the player joined the team.",
        now.toISOString(),
      );
      await new D1PipelineJobRepository(d1).enqueue({
        id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        trace_id: crypto.randomUUID(),
        occurred_at: now.toISOString(),
        version: 1,
        type: "source/article.ingested",
        payload: { raw_article_id: rawId, source_id: SOURCE_ID },
      });
      const mock = writer();
      const batch = d1.batch!;
      let interrupted = false;
      d1.batch = async (statements) => {
        if (!interrupted && mock.completeJson.mock.calls.length) {
          interrupted = true;
          throw new Error("fixture save interruption");
        }
        return batch(statements);
      };
      const capped = new DailyRequestCappedLlmClient(
        mock.client,
        "gemini",
        450,
        new D1LlmUsageRepository(d1),
        () => false,
        () => 0.001,
        { capUsd: 30, externalSpentUsd: 0 },
      );
      const options = {
        activationAt: new Date(now.getTime() - 60_000),
        siteUrl: "https://mso24.hu",
        forceReviewMode: false,
        facebookEnabled: false,
        facebookStartAt: now,
      };
      expect(await processOneD1Job(d1, options, capped, capped)).toMatchObject({ failed: 1 });
      expect(db.prepare("SELECT status FROM llm_usage").get()).toEqual({ status: "success" });
      db.prepare("UPDATE pipeline_jobs SET available_at=?").run(
        new Date(now.getTime() - 1000).toISOString(),
      );
      expect(await processOneD1Job(d1, options, capped, capped)).toMatchObject({
        failed: 1,
        error: { message: expect.stringContaining("writer_paid_result_missing") },
      });
      expect(mock.completeJson).toHaveBeenCalledTimes(1);
      expect(db.prepare("SELECT count(*) n FROM story_versions").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT count(*) n FROM story_read_model").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });
  it("preserves billing-blocked Stories, pauses all jobs, backs off, and resumes once without regenerating saved drafts", async () => {
    const { db, d1 } = fixture();
    try {
      const now = new Date();
      const jobs = new D1PipelineJobRepository(d1);
      for (const suffix of ["billing", "waiting"]) {
        const rawId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO raw_articles(id,source_id,source_url,title_original,body_original,language,content_origin,inline_images,extracted_entities,first_seen_at)
          VALUES(?,?,?,?,?,'en','full_article','[]','{}',?)`,
        ).run(
          rawId,
          SOURCE_ID,
          `https://example.com/football-${suffix}`,
          "Arsenal announces football signing",
          "Arsenal announced a new football signing. The club said the player joined the team.",
          now.toISOString(),
        );
        await jobs.enqueue({
          id: crypto.randomUUID(),
          correlation_id: crypto.randomUUID(),
          trace_id: crypto.randomUUID(),
          occurred_at: now.toISOString(),
          version: 1,
          type: "source/article.ingested",
          payload: { raw_article_id: rawId, source_id: SOURCE_ID },
        });
      }
      const good = writer();
      const call = vi
        .fn()
        .mockRejectedValueOnce(
          new GeminiApiError(402, "BILLING_UNAVAILABLE", "secret provider body"),
        )
        .mockRejectedValueOnce(
          new GeminiApiError(402, "BILLING_UNAVAILABLE", "secret provider body"),
        )
        .mockImplementation(good.completeJson);
      const capped = new DailyRequestCappedLlmClient(
        { ...good.client, completeJson: call },
        "gemini",
        450,
        new D1LlmUsageRepository(d1),
        () => false,
        () => 0.001,
        { capUsd: 30, externalSpentUsd: 0 },
      );
      const options = {
        activationAt: new Date(now.getTime() - 60_000),
        siteUrl: "https://mso24.hu",
        forceReviewMode: false,
        facebookEnabled: false,
        facebookStartAt: now,
      };
      const blocked = await processOneD1Job(d1, options, capped, capped);
      expect(blocked).toMatchObject({ processed: 1, providerDeferred: true });
      expect(new Date(blocked.retryAt!).getTime() - now.getTime()).toBeGreaterThanOrEqual(
        30 * 60_000,
      );
      expect(await loadWriterHealth(d1, options.activationAt)).toMatchObject({
        status: "BLOCKED",
        reason: "billing_unavailable",
      });
      expect(db.prepare("SELECT count(*) n FROM stories").get()).toEqual({ n: 1 });
      expect(db.prepare("SELECT count(*) n FROM story_versions").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT count(*) n FROM story_read_model").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT count(*) n FROM social_posts").get()).toEqual({ n: 0 });
      expect((await processOneD1Job(d1, options, capped, capped)).processed).toBe(0);
      expect(call).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify(db.prepare("SELECT last_error FROM pipeline_jobs").all()),
      ).not.toContain("secret");
      db.prepare(
        "UPDATE pipeline_jobs SET available_at=? WHERE last_error LIKE '[provider_ai_unavailable:%'",
      ).run(new Date(now.getTime() - 1000).toISOString());
      const again = await processOneD1Job(d1, options, capped, capped);
      expect(again).toMatchObject({ providerDeferred: true });
      expect(new Date(again.retryAt!).getTime() - now.getTime()).toBeGreaterThanOrEqual(
        60 * 60_000,
      );
      expect(db.prepare("SELECT max(attempts) n FROM pipeline_jobs").get()).toEqual({ n: 0 });
      db.prepare("UPDATE pipeline_jobs SET available_at=?").run(
        new Date(now.getTime() - 1000).toISOString(),
      );
      expect((await processOneD1Job(d1, options, capped, capped)).outcome).toMatchObject({
        status: "published",
      });
      expect(call).toHaveBeenCalledTimes(3);
      const savedEvent = JSON.parse(
        (
          db.prepare("SELECT event FROM pipeline_jobs WHERE status='completed' LIMIT 1").get() as {
            event: string;
          }
        ).event,
      );
      await jobs.enqueue(savedEvent);
      // Either pending Story may be claimed first; only the ungenerated one can call Writer.
      await processOneD1Job(d1, options, capped, capped);
      await processOneD1Job(d1, options, capped, capped);
      expect(call).toHaveBeenCalledTimes(4);
      expect(db.prepare("SELECT count(*) n FROM story_versions").get()).toEqual({ n: 2 });
    } finally {
      db.close();
    }
  });
  it("receives, queues, writes, validates, publishes, projects, and prepares one social intent", async () => {
    const { db, d1 } = fixture();
    try {
      const now = new Date();
      const raw = new D1RawArticleIngestRepository(d1);
      const receipt = await raw.insertTabloid(
        {
          sourceId: SOURCE_ID,
          sourceUrl: "https://example.com/football-arsenal",
          titleOriginal: "Arsenal announces football signing",
          bodyOriginal:
            "Arsenal announced a new football signing. The club said the player joined the team.",
          language: "en",
          extractedEntities: { rssGuid: "fixture-1" },
          rssGuid: "fixture-1",
          firstSeenAt: now,
          publishedAtSource: new Date(now.getTime() - 30_000),
          contentOrigin: "rss_snippet",
          processingStatus: "awaiting_full_article",
          processingAvailableAt: now,
        },
        false,
      );
      expect(receipt?.id).toBeTruthy();
      if (!receipt) throw new Error("RSS receipt missing");
      const [fetch] = await raw.claimTabloidFetchBatch(
        [SOURCE_ID],
        1,
        300_000,
        new Date(now.getTime() + 1000),
        new Date(now.getTime() - 60_000),
      );
      expect(fetch?.processingOwner).toBeTruthy();
      if (!fetch?.processingOwner) throw new Error("Full-article fetch claim missing");
      expect(
        await raw.upgradeAndEnqueueTabloid(
          receipt.id,
          {
            sourceUrl: "https://example.com/football-arsenal",
            titleOriginal: "Arsenal announces football signing",
            bodyOriginal:
              "Arsenal announced a new football signing. The club said the player joined the team.",
            subtitleOriginal: null,
            authorOriginal: null,
            publishedAtSource: new Date(now.getTime() - 30_000),
            imageUrl: null,
            inlineImages: [],
          },
          fetch.processingOwner,
        ),
      ).toBe(true);
      const mock = writer();
      const options = {
        activationAt: new Date(now.getTime() - 60_000),
        siteUrl: "https://mso24.hu",
        forceReviewMode: false,
        facebookEnabled: true,
        facebookStartAt: new Date(now.getTime() - 60_000),
      };
      const result = await processOneD1Job(d1, options, mock.client, mock.client);
      expect(result).toMatchObject({
        processed: 1,
        succeeded: 1,
        outcome: { status: "published" },
      });
      expect(mock.completeJson).toHaveBeenCalledTimes(1);
      expect(
        db.prepare("SELECT count(*) n FROM language_qa_audits WHERE status='queued'").get(),
      ).toEqual({ n: 1 });
      const published = result.outcome as { storyId: string; slug: string };
      expect((await new D1StoryReadModelRepository(d1).getBySlug(published.slug))?.storyId).toBe(
        published.storyId,
      );
      expect((db.prepare("SELECT count(*) AS n FROM social_posts").get() as { n: number }).n).toBe(
        1,
      );
      expect(
        (db.prepare("SELECT count(*) AS n FROM story_versions").get() as { n: number }).n,
      ).toBe(1);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect((await processOneD1Job(d1, options, mock.client, mock.client)).processed).toBe(0);
      const savedEvent = (
        db.prepare("SELECT event FROM pipeline_jobs LIMIT 1").get() as { event: string }
      ).event;
      await new D1PipelineJobRepository(d1).enqueue(JSON.parse(savedEvent));
      expect((await processOneD1Job(d1, options, mock.client, mock.client)).processed).toBe(1);
      expect(mock.completeJson).toHaveBeenCalledTimes(1);
      expect((db.prepare("SELECT count(*) AS n FROM stories").get() as { n: number }).n).toBe(1);
      expect(
        (db.prepare("SELECT count(*) AS n FROM story_versions").get() as { n: number }).n,
      ).toBe(1);
      expect((db.prepare("SELECT count(*) AS n FROM social_posts").get() as { n: number }).n).toBe(
        1,
      );
    } finally {
      db.close();
    }
  });

  it("validates a persisted draft after interruption without repeating the Writer call", async () => {
    const { db, d1 } = fixture();
    try {
      const now = new Date();
      const rawId = crypto.randomUUID();
      const storyId = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      const sourceUrl = "https://example.com/football-resume";
      db.prepare(
        `INSERT INTO stories (id,canonical_title,version_count)
        VALUES (?,'Arsenal announces football signing',1)`,
      ).run(storyId);
      db.prepare(`INSERT INTO story_fingerprints (fingerprint_hash,story_id) VALUES (?,?)`).run(
        createHash("sha256").update(`tabloid:${SOURCE_ID}:${rawId}`).digest("hex"),
        storyId,
      );
      db.prepare(
        `INSERT INTO raw_articles (id,source_id,source_url,title_original,body_original,
        language,content_origin,inline_images,extracted_entities,first_seen_at,story_id)
        VALUES (?,?,?,?,?,'en','full_article','[]','{}',?,?)`,
      ).run(
        rawId,
        SOURCE_ID,
        sourceUrl,
        "Arsenal announces football signing",
        "Arsenal announced a new football signing. The club said the player joined the team.",
        now.toISOString(),
        storyId,
      );
      const response = writer();
      const data = {
        title_hu: "Az Arsenal új játékossal erősített",
        lead_hu: "Az angol klub közölte az új labdarúgó érkezését.",
        body_hu:
          "Az Arsenal bejelentette, hogy új játékossal erősítette meg a keretét. A klub közlése szerint az érkező labdarúgó csatlakozott a csapathoz.",
      };
      db.prepare(
        `INSERT INTO story_versions (id,story_id,version_number,title_hu,lead_hu,
        body_hu,generated_by_model,prompt_version,quality_issues)
        VALUES (?,?,1,?,?,?,'mock-writer',?,?)`,
      ).run(
        versionId,
        storyId,
        data.title_hu,
        data.lead_hu,
        data.body_hu,
        tabloid.TABLOID_PROMPT,
        JSON.stringify([
          { kind: "hard", code: "writer_validation_pending", field: "body", repaired: false },
        ]),
      );
      await new D1PipelineJobRepository(d1).enqueue({
        id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        trace_id: crypto.randomUUID(),
        occurred_at: now.toISOString(),
        version: 1,
        type: "source/article.ingested",
        payload: { raw_article_id: rawId, source_id: SOURCE_ID },
      });
      const outcome = await processOneD1Job(
        d1,
        {
          activationAt: new Date(now.getTime() - 60_000),
          siteUrl: "https://mso24.hu",
          forceReviewMode: false,
          facebookEnabled: false,
          facebookStartAt: now,
        },
        response.client,
        response.client,
      );
      expect(outcome).toMatchObject({
        processed: 1,
        succeeded: 1,
        outcome: { status: "published", versionId },
      });
      expect(response.completeJson).not.toHaveBeenCalled();
      expect(
        (db.prepare("SELECT count(*) AS n FROM story_versions").get() as { n: number }).n,
      ).toBe(1);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("records a Writer failure, retries after backoff, and publishes only one version", async () => {
    const { db, d1 } = fixture();
    try {
      const now = new Date();
      const rawId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO raw_articles (id,source_id,source_url,title_original,body_original,
        language,content_origin,inline_images,extracted_entities,first_seen_at)
        VALUES (?,?,?,?,?,'en','full_article','[]','{}',?)`,
      ).run(
        rawId,
        SOURCE_ID,
        "https://example.com/football-retry",
        "Arsenal announces football signing",
        "Arsenal announced a new football signing. The club said the player joined the team.",
        now.toISOString(),
      );
      await new D1PipelineJobRepository(d1).enqueue({
        id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        trace_id: crypto.randomUUID(),
        occurred_at: now.toISOString(),
        version: 1,
        type: "source/article.ingested",
        payload: { raw_article_id: rawId, source_id: SOURCE_ID },
      });
      const good = writer();
      const completeJson = vi
        .fn()
        .mockRejectedValueOnce(new Error("fixture Writer unavailable"))
        .mockImplementation(good.completeJson);
      const client = { ...good.client, completeJson } as LlmClient;
      const repair = writer();
      const options = {
        activationAt: new Date(now.getTime() - 60_000),
        siteUrl: "https://mso24.hu",
        forceReviewMode: false,
        facebookEnabled: false,
        facebookStartAt: now,
      };
      const failed = await processOneD1Job(d1, options, client, repair.client);
      expect(failed).toMatchObject({
        processed: 1,
        failed: 1,
        error: { message: "Tabloid writer provider or schema failure" },
      });
      expect(
        (db.prepare("SELECT count(*) AS n FROM story_versions").get() as { n: number }).n,
      ).toBe(0);
      expect((db.prepare("SELECT count(*) AS n FROM social_posts").get() as { n: number }).n).toBe(
        0,
      );
      const lease = db
        .prepare(
          "SELECT json_extract(extracted_entities,'$.tabloidWriterLease') AS lease FROM raw_articles WHERE id=?",
        )
        .get(rawId) as { lease: string | null };
      expect(lease.lease).toBeNull();
      db.prepare("UPDATE pipeline_jobs SET available_at=?").run(
        new Date(now.getTime() - 1000).toISOString(),
      );
      const resumed = await processOneD1Job(d1, options, client, repair.client);
      expect(resumed).toMatchObject({
        processed: 1,
        succeeded: 1,
        outcome: { status: "published" },
      });
      expect(completeJson).toHaveBeenCalledTimes(2);
      expect(repair.completeJson).not.toHaveBeenCalled();
      expect((db.prepare("SELECT count(*) AS n FROM stories").get() as { n: number }).n).toBe(1);
      expect(
        (db.prepare("SELECT count(*) AS n FROM story_versions").get() as { n: number }).n,
      ).toBe(1);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("sends an unsupported numeric claim to review without publishing or repeating generation", async () => {
    const { db, d1 } = fixture();
    try {
      const now = new Date();
      const rawId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO raw_articles (id,source_id,source_url,title_original,body_original,
        language,content_origin,inline_images,extracted_entities,first_seen_at)
        VALUES (?,?,?,?,?,'en','full_article','[]','{}',?)`,
      ).run(
        rawId,
        SOURCE_ID,
        "https://example.com/football-quality",
        "Arsenal announces football signing",
        "Arsenal announced a new football signing. The club said the player joined the team.",
        now.toISOString(),
      );
      await new D1PipelineJobRepository(d1).enqueue({
        id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        trace_id: crypto.randomUUID(),
        occurred_at: now.toISOString(),
        version: 1,
        type: "source/article.ingested",
        payload: { raw_article_id: rawId, source_id: SOURCE_ID },
      });
      const mock = writer();
      mock.completeJson.mockResolvedValue({
        data: {
          title_hu: "Az Arsenal 99 játékost igazolt",
          lead_hu: "Az angol klub közölte az új labdarúgó érkezését.",
          body_hu:
            "Az Arsenal bejelentette, hogy új játékossal erősítette meg a keretét. A klub közlése szerint az érkező labdarúgó csatlakozott a csapathoz.",
          language_warnings: [],
        },
        inputTokens: 100,
        outputTokens: 80,
        modelLabel: "mock-writer",
      });
      const options = {
        activationAt: new Date(now.getTime() - 60_000),
        siteUrl: "https://mso24.hu",
        forceReviewMode: false,
        facebookEnabled: true,
        facebookStartAt: new Date(now.getTime() - 60_000),
      };
      const result = await processOneD1Job(d1, options, mock.client, mock.client);
      expect(result).toMatchObject({ processed: 1, succeeded: 1, outcome: { status: "review" } });
      expect(
        (db.prepare("SELECT count(*) AS n FROM review_queue_items").get() as { n: number }).n,
      ).toBe(1);
      expect(
        (db.prepare("SELECT count(*) AS n FROM story_read_model").get() as { n: number }).n,
      ).toBe(0);
      expect((db.prepare("SELECT count(*) AS n FROM social_posts").get() as { n: number }).n).toBe(
        0,
      );
      expect(mock.completeJson).toHaveBeenCalledTimes(1);
      const event = JSON.parse(
        (db.prepare("SELECT event FROM pipeline_jobs").get() as { event: string }).event,
      );
      await new D1PipelineJobRepository(d1).enqueue(event);
      expect((await processOneD1Job(d1, options, mock.client, mock.client)).outcome).toMatchObject({
        status: "review",
      });
      expect(mock.completeJson).toHaveBeenCalledTimes(1);
      expect(
        (db.prepare("SELECT count(*) AS n FROM story_versions").get() as { n: number }).n,
      ).toBe(1);
    } finally {
      db.close();
    }
  });

  it("meters a mock provider through D1 and stops a second new Story at the daily cap", async () => {
    const { db, d1 } = fixture();
    try {
      const now = new Date();
      const jobs = new D1PipelineJobRepository(d1);
      for (const suffix of ["first", "second"]) {
        const rawId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO raw_articles (id,source_id,source_url,title_original,body_original,
          language,content_origin,inline_images,extracted_entities,first_seen_at)
          VALUES (?,?,?,?,?,'en','full_article','[]','{}',?)`,
        ).run(
          rawId,
          SOURCE_ID,
          `https://example.com/football-${suffix}`,
          `Arsenal football signing ${suffix}`,
          "Arsenal announced a new football signing. The club said the player joined the team.",
          now.toISOString(),
        );
        await jobs.enqueue({
          id: crypto.randomUUID(),
          correlation_id: crypto.randomUUID(),
          trace_id: crypto.randomUUID(),
          occurred_at: now.toISOString(),
          version: 1,
          type: "source/article.ingested",
          payload: { raw_article_id: rawId, source_id: SOURCE_ID },
        });
      }
      const mock = writer();
      const capped = new DailyRequestCappedLlmClient(
        mock.client,
        "gemini",
        1,
        new D1LlmUsageRepository(d1),
        () => false,
        () => 0.001,
      );
      const options = {
        activationAt: new Date(now.getTime() - 60_000),
        siteUrl: "https://mso24.hu",
        forceReviewMode: false,
        facebookEnabled: false,
        facebookStartAt: now,
      };
      expect((await processOneD1Job(d1, options, capped, capped)).outcome).toMatchObject({
        status: "published",
      });
      const second = await processOneD1Job(d1, options, capped, capped);
      expect(second).toMatchObject({ processed: 1, quotaDeferred: true });
      expect(mock.completeJson).toHaveBeenCalledTimes(1);
      expect((db.prepare("SELECT count(*) AS n FROM llm_usage").get() as { n: number }).n).toBe(1);
      expect(
        (db.prepare("SELECT sum(cost_usd) AS cost FROM llm_usage").get() as { cost: number }).cost,
      ).toBeCloseTo(0.001);
      expect(
        (db.prepare("SELECT count(*) AS n FROM story_versions").get() as { n: number }).n,
      ).toBe(1);
    } finally {
      db.close();
    }
  });
});
