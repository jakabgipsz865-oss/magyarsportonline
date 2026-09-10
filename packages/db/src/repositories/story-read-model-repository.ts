import { TABLOID_PUBLIC_PROMPT, TABLOID_PUBLIC_START } from "@magyarsportonline/shared";
import { and, desc, eq, gte, sql } from "drizzle-orm";
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
const publicGeneration = and(
  gte(storyReadModel.publishedAt, new Date(TABLOID_PUBLIC_START)),
  sql`${storyReadModel.versionHistorySummary} @> ${JSON.stringify([
    { prompt_version: TABLOID_PUBLIC_PROMPT, is_current: true },
  ])}::jsonb`,
);

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
      .where(and(eq(storyReadModel.slug, slug), publicGeneration))
      .limit(1);
    return row ?? null;
  }

  async listPublished(params: { limit: number; offset: number }): Promise<StoryReadModelRow[]> {
    return this.db
      .select()
      .from(storyReadModel)
      .where(publicGeneration)
      .orderBy(desc(storyReadModel.publishedAt))
      .limit(params.limit)
      .offset(params.offset);
  }

  /**
   * Every row here is, by construction, published (only ever upserted by
   * the read-model-projector on `story/published`) and every public surface
   * (`/hir/[slug]`, sitemap, RSS, `api/v1/stories`) reads exclusively from
   * this table. Called defensively by the invalid-merge repair operation
   * (2026-07-29) so a Story archived as `invalid_merge` cannot remain
   * publicly visible even in the edge case where it had already been
   * manually approved through the review queue before being caught.
   */
  async deleteByStoryId(storyId: string): Promise<void> {
    await this.db.delete(storyReadModel).where(eq(storyReadModel.storyId, storyId));
  }
}
