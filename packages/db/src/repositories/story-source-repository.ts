import type { StorySourceContributionType } from "@magyarsportonline/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { rawArticles, sources, storySources } from "../schema/index";

export type StorySource = typeof storySources.$inferSelect;

export interface StorySourceSummaryItem {
  name: string;
  url: string;
  firstSeenAt: string;
}

/** Bounded-context repository for the Story Merge Agent (docs/architecture/02-agents.md §2.3). */
export class StorySourceRepository {
  constructor(private readonly db: Database) {}

  /**
   * Links a RawArticle to a Story. Idempotent via the
   * `(story_id, raw_article_id)` unique constraint (docs/architecture/03-event-flow.md
   * §3.6) — a duplicate call (at-least-once redelivery) is a silent no-op
   * rather than a thrown error.
   */
  async link(
    storyId: string,
    rawArticleId: string,
    contributionType: StorySourceContributionType,
  ): Promise<void> {
    await this.db
      .insert(storySources)
      .values({ storyId, rawArticleId, contributionType })
      .onConflictDoNothing({
        target: [storySources.storyId, storySources.rawArticleId],
      });
  }

  async countByStoryId(storyId: string): Promise<number> {
    const rows = await this.db
      .select({ id: storySources.id })
      .from(storySources)
      .where(eq(storySources.storyId, storyId));
    return rows.length;
  }

  /** Pre-joined source list for the `story_read_model.sources_summary` projection. */
  async summaryByStoryId(storyId: string): Promise<StorySourceSummaryItem[]> {
    const rows = await this.db
      .select({
        name: sources.name,
        url: rawArticles.sourceUrl,
        firstSeenAt: storySources.linkedAt,
      })
      .from(storySources)
      .innerJoin(rawArticles, eq(storySources.rawArticleId, rawArticles.id))
      .innerJoin(sources, eq(rawArticles.sourceId, sources.id))
      .where(eq(storySources.storyId, storyId));
    return rows.map((row) => ({
      name: row.name,
      url: row.url,
      firstSeenAt: row.firstSeenAt.toISOString(),
    }));
  }
}
