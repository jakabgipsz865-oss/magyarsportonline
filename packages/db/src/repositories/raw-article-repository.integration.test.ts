import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { RawArticleRepository } from "./raw-article-repository";

const connectionString = process.env["MSO_TEST_DATABASE_URL"];
const integration = describe.skipIf(!connectionString);
const sourceId = "00000000-0000-0000-0000-000000000001";

integration("RawArticleRepository RSS receipt recovery", () => {
  let client: ReturnType<typeof postgres>;
  let repo: RawArticleRepository;

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 8 });
    const db = drizzle(client);
    for (const statement of [
      "CREATE TYPE ingest_status AS ENUM ('ingested','deduped','merged','error')",
      "CREATE TYPE pipeline_job_status AS ENUM ('pending','in_progress','completed','dead_letter')",
    ])
      await client.unsafe(statement).catch((error: unknown) => {
        if (!(error instanceof Error) || !error.message.includes("already exists")) throw error;
      });
    await client.unsafe(`CREATE TABLE IF NOT EXISTS pipeline_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event jsonb NOT NULL,
      status pipeline_job_status NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5,
      available_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz,
      claim_owner text, claim_version integer NOT NULL DEFAULT 0,
      last_error text, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.unsafe(`CREATE TABLE IF NOT EXISTS raw_articles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL,
      source_url text NOT NULL, title_original text NOT NULL,
      subtitle_original text, body_original text NOT NULL,
      content_origin text NOT NULL DEFAULT 'rss_snippet',
      rss_title text, rss_description text, rss_guid text,
      first_seen_at timestamptz, processing_status text, decision_reason text,
      processing_attempts integer NOT NULL DEFAULT 0,
      processing_available_at timestamptz, processing_owner text,
      processing_locked_at timestamptz, author_original text, image_url text,
      inline_images jsonb NOT NULL DEFAULT '[]', language text NOT NULL,
      embedding text, extracted_entities jsonb,
      ingest_status ingest_status NOT NULL DEFAULT 'ingested',
      story_id uuid, published_at_source timestamptz,
      ingested_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.unsafe(
      "CREATE UNIQUE INDEX IF NOT EXISTS raw_articles_source_url_unique ON raw_articles (source_id, source_url)",
    );
    await client.unsafe(
      "CREATE UNIQUE INDEX IF NOT EXISTS raw_articles_source_guid_unique ON raw_articles (source_id, (extracted_entities->>'rssGuid'))",
    );
    repo = new RawArticleRepository(db as never);
  });
  beforeEach(async () => {
    await client.unsafe("TRUNCATE pipeline_jobs");
    await client.unsafe("TRUNCATE raw_articles");
  });
  afterAll(async () => {
    await client?.end();
  });

  it("retains one immutable receipt, retries the full page, and fences the old fetcher", async () => {
    const firstSeenAt = new Date("2026-09-27T10:00:00Z");
    const receipt = {
      sourceId,
      sourceUrl: "https://publisher.test/article",
      titleOriginal: "RSS headline",
      bodyOriginal: "RSS description",
      language: "en",
      rssTitle: "RSS headline",
      rssDescription: "RSS description",
      rssGuid: "guid-1",
      firstSeenAt,
      processingStatus: "awaiting_full_article",
      decisionReason: "awaiting_processing_capacity",
      processingAvailableAt: new Date(Date.now() - 1000),
      extractedEntities: { rssGuid: "guid-1" },
    };
    const first = await repo.insertTabloid(receipt, false);
    expect(first).not.toBeNull();
    expect(await repo.insertTabloid({ ...receipt, firstSeenAt: new Date() }, false)).toBeNull();
    const [claimed] = await repo.claimTabloidFetchBatch([sourceId], 4, 1000);
    expect(claimed?.id).toBe(first!.id);
    expect(claimed?.processingOwner).toBeTruthy();
    expect(await repo.deferTabloidFetch(first!.id, claimed!.processingOwner!, "timeout", 1)).toBe(
      true,
    );
    await client.unsafe(
      "UPDATE raw_articles SET processing_available_at = now() - interval '1 second' WHERE id = $1",
      [first!.id],
    );
    const [reclaimed] = await repo.claimTabloidFetchBatch([sourceId], 4, 1000);
    expect(reclaimed?.processingOwner).not.toBe(claimed?.processingOwner);
    const full = {
      sourceUrl: receipt.sourceUrl,
      titleOriginal: "Full headline",
      subtitleOriginal: null,
      bodyOriginal: "The full source article.",
      authorOriginal: null,
      publishedAtSource: new Date("2026-09-27T09:59:00Z"),
      imageUrl: null,
      inlineImages: [],
    };
    expect(await repo.upgradeAndEnqueueTabloid(first!.id, full, claimed!.processingOwner!)).toBe(
      false,
    );
    expect(await repo.upgradeAndEnqueueTabloid(first!.id, full, reclaimed!.processingOwner!)).toBe(
      true,
    );
    const [saved] = await client.unsafe(
      "SELECT rss_title, rss_description, rss_guid, first_seen_at, title_original, processing_status FROM raw_articles WHERE id = $1",
      [first!.id],
    );
    expect(saved?.["rss_title"]).toBe("RSS headline");
    expect(saved?.["rss_description"]).toBe("RSS description");
    expect(saved?.["rss_guid"]).toBe("guid-1");
    expect(new Date(saved!["first_seen_at"] as string)).toEqual(firstSeenAt);
    expect(saved?.["title_original"]).toBe("Full headline");
    expect(saved?.["processing_status"]).toBe("queued");
    const [jobs] = await client.unsafe("SELECT count(*)::int AS count FROM pipeline_jobs");
    expect(jobs?.["count"]).toBe(1);
  });
});
