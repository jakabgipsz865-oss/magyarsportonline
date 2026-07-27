import { eq } from "drizzle-orm";
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
}
