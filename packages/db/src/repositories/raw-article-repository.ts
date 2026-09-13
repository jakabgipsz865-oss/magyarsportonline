import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import { pipelineJobs, rawArticles } from "../schema/index";
import type { SourceInlineImage } from "@magyarsportonline/shared";

export type RawArticle = typeof rawArticles.$inferSelect;
export type NewRawArticle = typeof rawArticles.$inferInsert;

/**
 * Bounded-context repository for the Source Ingest and Deduplication agents
 * (docs/architecture/02-agents.md §2.1–2.2).
 */
export class RawArticleRepository {
  constructor(private readonly db: Database) {}

  /** Serialize deliveries for one article, including the single writer call. */
  async withTabloidLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"tabloid:" + id}, 0))`);
      return work();
    });
  }

  /** Exact source URL/GUID uniqueness is enforced by two database indexes.
   * Article and queue event are committed together, so a retry cannot lose work. */
  async insertTabloid(data: NewRawArticle, enqueue: boolean): Promise<RawArticle | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(rawArticles).values(data).onConflictDoNothing().returning();
      if (!row) return null;
      if (enqueue) {
        await tx.insert(pipelineJobs).values({
          event: {
            id: crypto.randomUUID(),
            correlation_id: crypto.randomUUID(),
            occurred_at: new Date().toISOString(),
            version: 1,
            trace_id: crypto.randomUUID(),
            type: "source/article.ingested",
            payload: { raw_article_id: row.id, source_id: row.sourceId },
          },
        });
      }
      return row;
    });
  }

  async findTabloidProof(language: string, generation: string): Promise<RawArticle | null> {
    const [row] = await this.db
      .select()
      .from(rawArticles)
      .where(
        and(
          sql`${rawArticles.extractedEntities}->>'tabloidProofLanguage' = ${language}`,
          sql`${rawArticles.extractedEntities}->>'tabloidProofGeneration' = ${generation}`,
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async claimTabloidWriter(id: string): Promise<boolean> {
    const rows = await this.db
      .update(rawArticles)
      .set({
        extractedEntities: sql`coalesce(${rawArticles.extractedEntities}, '{}'::jsonb) || '{"tabloidWriterAttempted":true}'::jsonb`,
      })
      .where(
        and(
          eq(rawArticles.id, id),
          sql`coalesce(${rawArticles.extractedEntities}->>'tabloidWriterAttempted', 'false') <> 'true'`,
        ),
      )
      .returning({ id: rawArticles.id });
    return rows.length > 0;
  }

  async releaseTabloidQuotaDeferral(id: string): Promise<void> {
    await this.db
      .update(rawArticles)
      .set({
        extractedEntities: sql`${rawArticles.extractedEntities} - 'tabloidWriterAttempted'`,
      })
      .where(eq(rawArticles.id, id));
  }

  async updateInlineImages(
    id: string,
    inlineImages: SourceInlineImage[],
    imageUrl?: string | null,
  ): Promise<void> {
    await this.db
      .update(rawArticles)
      .set({ inlineImages, ...(imageUrl ? { imageUrl } : {}) })
      .where(eq(rawArticles.id, id));
  }

  async getContentHealth(): Promise<{
    total: number;
    fullArticle: number;
    rssSnippet: number;
    averageBodyLength: number;
  }> {
    const [row] = await this.db.execute<{
      total: number | string;
      full_article: number | string;
      rss_snippet: number | string;
      average_body_length: number | string;
    }>(sql`SELECT count(*) AS total,
      count(*) FILTER (WHERE content_origin = 'full_article') AS full_article,
      count(*) FILTER (WHERE content_origin = 'rss_snippet') AS rss_snippet,
      coalesce(avg(length(body_original)), 0)::int AS average_body_length
      FROM ${rawArticles}`);
    return {
      total: Number(row?.total ?? 0),
      fullArticle: Number(row?.full_article ?? 0),
      rssSnippet: Number(row?.rss_snippet ?? 0),
      averageBodyLength: Number(row?.average_body_length ?? 0),
    };
  }

  /** URL-based dedup (docs/architecture/02-agents.md §2.1 step 4). */
  async findBySourceUrl(sourceUrl: string): Promise<RawArticle | null> {
    const [row] = await this.db
      .select()
      .from(rawArticles)
      .where(eq(rawArticles.sourceUrl, sourceUrl))
      .limit(1);
    return row ?? null;
  }

  async insert(data: NewRawArticle): Promise<RawArticle> {
    const [row] = await this.db.insert(rawArticles).values(data).returning();
    if (!row) {
      throw new Error("RawArticle insert returned no row");
    }
    return row;
  }

  /**
   * Upgrades a previously stored RSS snippet when the Source Fetcher can
   * later retrieve the same URL's complete article. The origin predicate
   * makes this monotonic: a full article can never be overwritten by a
   * shorter feed payload on a later ingest cycle.
   */
  async upgradeFromFullArticle(
    id: string,
    data: Pick<
      NewRawArticle,
      | "titleOriginal"
      | "sourceUrl"
      | "subtitleOriginal"
      | "bodyOriginal"
      | "authorOriginal"
      | "publishedAtSource"
      | "imageUrl"
      | "inlineImages"
    >,
  ): Promise<boolean> {
    const rows = await this.db
      .update(rawArticles)
      .set({ ...data, contentOrigin: "full_article" })
      .where(and(eq(rawArticles.id, id), eq(rawArticles.contentOrigin, "rss_snippet")))
      .returning({ id: rawArticles.id });
    return rows.length > 0;
  }

  /** Targeted repair for a legacy video URL after deterministic text-report resolution. */
  async replaceWithResolvedFullArticle(
    id: string,
    data: Pick<
      NewRawArticle,
      | "sourceUrl"
      | "titleOriginal"
      | "subtitleOriginal"
      | "bodyOriginal"
      | "authorOriginal"
      | "publishedAtSource"
      | "imageUrl"
      | "inlineImages"
    >,
  ): Promise<boolean> {
    const rows = await this.db
      .update(rawArticles)
      .set({ ...data, contentOrigin: "full_article" })
      .where(eq(rawArticles.id, id))
      .returning({ id: rawArticles.id });
    return rows.length > 0;
  }

  async getById(id: string): Promise<RawArticle | null> {
    const [row] = await this.db.select().from(rawArticles).where(eq(rawArticles.id, id)).limit(1);
    return row ?? null;
  }

  async listByStoryId(storyId: string): Promise<RawArticle[]> {
    return this.db.select().from(rawArticles).where(eq(rawArticles.storyId, storyId));
  }

  async linkToStory(rawArticleId: string, storyId: string): Promise<void> {
    await this.db
      .update(rawArticles)
      .set({ storyId, ingestStatus: "merged" })
      .where(eq(rawArticles.id, rawArticleId));
  }

  /**
   * Reverses `linkToStory` for a data-repair operation (2026-07-29,
   * docs/open-decisions.md #14) — detaches a RawArticle from a Story being
   * archived as an invalid merge, resetting it back to `ingested` so it can
   * be re-enqueued through the (now-fixed) matching pipeline from scratch.
   */
  async detachFromStory(rawArticleId: string): Promise<void> {
    await this.db
      .update(rawArticles)
      .set({ storyId: null, ingestStatus: "ingested" })
      .where(eq(rawArticles.id, rawArticleId));
  }
}
