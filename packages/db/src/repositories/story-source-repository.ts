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

export interface OriginalSourceContent {
  sourceName: string;
  sourceUrl: string;
  titleOriginal: string;
  bodyOriginal: string;
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

  /**
   * The original, untranslated English article(s) a Story was built from —
   * for the `/internal/editorial-ab-review` admin page, so a human reviewer
   * can compare the Hungarian Writer/Editorial Rewrite output against the
   * actual source text. A merged Story can have more than one contributing
   * raw article.
   */
  async originalContentByStoryId(storyId: string): Promise<OriginalSourceContent[]> {
    const rows = await this.db
      .select({
        sourceName: sources.name,
        sourceUrl: rawArticles.sourceUrl,
        titleOriginal: rawArticles.titleOriginal,
        bodyOriginal: rawArticles.bodyOriginal,
      })
      .from(storySources)
      .innerJoin(rawArticles, eq(storySources.rawArticleId, rawArticles.id))
      .innerJoin(sources, eq(rawArticles.sourceId, sources.id))
      .where(eq(storySources.storyId, storyId));
    return rows;
  }
}
