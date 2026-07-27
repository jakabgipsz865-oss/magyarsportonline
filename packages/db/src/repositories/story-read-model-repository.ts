import { desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { storyReadModel } from "../schema/index";

export type StoryReadModelRow = typeof storyReadModel.$inferSelect;
export type NewStoryReadModelRow = typeof storyReadModel.$inferInsert;

/**
 * The ONLY repository the public frontend/API may use
 * (docs/architecture/01-data-model.md §1.5.2, 09-architecture-review.md §5) —
 * it reads/writes exclusively the denormalized `story_read_model` projection,
 * never the normalized write-side tables.
 */
export class StoryReadModelRepository {
  constructor(private readonly db: Database) {}

  async upsert(row: NewStoryReadModelRow): Promise<void> {
    await this.db.insert(storyReadModel).values(row).onConflictDoUpdate({
      target: storyReadModel.storyId,
      set: row,
    });
  }

  async getBySlug(slug: string): Promise<StoryReadModelRow | null> {
    const [row] = await this.db
      .select()
      .from(storyReadModel)
      .where(eq(storyReadModel.slug, slug))
      .limit(1);
    return row ?? null;
  }

  async listPublished(params: { limit: number; offset: number }): Promise<StoryReadModelRow[]> {
    return this.db
      .select()
      .from(storyReadModel)
      .orderBy(desc(storyReadModel.publishedAt))
      .limit(params.limit)
      .offset(params.offset);
  }
}
