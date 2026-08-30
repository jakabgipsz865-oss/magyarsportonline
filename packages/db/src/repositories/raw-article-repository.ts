import { and, eq } from "drizzle-orm";
import type { Database } from "../client";
import { rawArticles } from "../schema/index";

export type RawArticle = typeof rawArticles.$inferSelect;
export type NewRawArticle = typeof rawArticles.$inferInsert;

/**
 * Bounded-context repository for the Source Ingest and Deduplication agents
 * (docs/architecture/02-agents.md §2.1–2.2).
 */
export class RawArticleRepository {
  constructor(private readonly db: Database) {}

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
      | "subtitleOriginal"
      | "bodyOriginal"
      | "authorOriginal"
      | "publishedAtSource"
      | "imageUrl"
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
