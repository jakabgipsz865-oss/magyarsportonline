import type {
  SourceCategory,
  SourceReliabilityTier,
  StorySourceContributionType,
} from "@magyarsportonline/shared";
import { and, eq } from "drizzle-orm";
import type { Database } from "../client";
import { rawArticles, sources, storySources } from "../schema/index";

export type StorySource = typeof storySources.$inferSelect;

export interface StorySourceSummaryItem {
  name: string;
  url: string;
  firstSeenAt: string;
  reliabilityTier: SourceReliabilityTier;
}

export interface OriginalSourceContent {
  sourceName: string;
  sourceUrl: string;
  titleOriginal: string;
  bodyOriginal: string;
  contentOrigin: string;
}

/**
 * Egy Story hitelesség-újraszámolásához szükséges, forrásonkénti metaadat
 * (2026-07-28-i "Hitelességi mutató v1" sprint,
 * packages/agents/src/fact-verification/recompute-credibility.ts). Az
 * `excluded` sorok IS szerepelnek a listában (az admin felületnek látnia
 * kell őket a vissza-bekapcsoláshoz) — a hívó felel a szűrésért.
 */
export interface StorySourceWithMeta {
  storyId: string;
  rawArticleId: string;
  sourceId: string;
  sourceName: string;
  category: SourceCategory | null;
  reliabilityTier: SourceReliabilityTier;
  contributionType: StorySourceContributionType;
  excluded: boolean;
  excludedReason: string | null;
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

  /** Reverses `link` for a data-repair operation (2026-07-29, docs/open-decisions.md #14) — detaching a RawArticle from a Story being archived as an invalid merge. */
  async unlink(storyId: string, rawArticleId: string): Promise<void> {
    await this.db
      .delete(storySources)
      .where(and(eq(storySources.storyId, storyId), eq(storySources.rawArticleId, rawArticleId)));
  }

  async countByStoryId(storyId: string): Promise<number> {
    const rows = await this.db
      .select({ id: storySources.id })
      .from(storySources)
      .where(eq(storySources.storyId, storyId));
    return rows.length;
  }

  async countFullArticleByStoryId(storyId: string): Promise<number> {
    const rows = await this.db
      .select({ id: storySources.id })
      .from(storySources)
      .innerJoin(rawArticles, eq(storySources.rawArticleId, rawArticles.id))
      .where(
        and(
          eq(storySources.storyId, storyId),
          eq(storySources.excluded, false),
          eq(rawArticles.contentOrigin, "full_article"),
        ),
      );
    return rows.length;
  }

  /**
   * Pre-joined source list for the `story_read_model.sources_summary`
   * projection — admin-excluded sources (2026-07-28) are left out, since
   * this feeds the PUBLIC page.
   */
  async summaryByStoryId(storyId: string): Promise<StorySourceSummaryItem[]> {
    const rows = await this.db
      .select({
        name: sources.name,
        url: rawArticles.sourceUrl,
        firstSeenAt: storySources.linkedAt,
        reliabilityTier: sources.reliabilityTier,
      })
      .from(storySources)
      .innerJoin(rawArticles, eq(storySources.rawArticleId, rawArticles.id))
      .innerJoin(sources, eq(rawArticles.sourceId, sources.id))
      .where(and(eq(storySources.storyId, storyId), eq(storySources.excluded, false)));
    return rows.map((row) => ({
      name: row.name,
      url: row.url,
      firstSeenAt: row.firstSeenAt.toISOString(),
      reliabilityTier: row.reliabilityTier,
    }));
  }

  /**
   * Minden forrás-kapcsolat metaadata a hitelesség-újraszámoláshoz és az
   * admin szerkesztőfelülethez (2026-07-28) — a kizártakat IS visszaadja.
   */
  async sourcesWithMetaByStoryId(storyId: string): Promise<StorySourceWithMeta[]> {
    const rows = await this.db
      .select({
        storyId: storySources.storyId,
        rawArticleId: storySources.rawArticleId,
        sourceId: rawArticles.sourceId,
        sourceName: sources.name,
        category: sources.category,
        reliabilityTier: sources.reliabilityTier,
        contributionType: storySources.contributionType,
        excluded: storySources.excluded,
        excludedReason: storySources.excludedReason,
      })
      .from(storySources)
      .innerJoin(rawArticles, eq(storySources.rawArticleId, rawArticles.id))
      .innerJoin(sources, eq(rawArticles.sourceId, sources.id))
      .where(eq(storySources.storyId, storyId));
    return rows;
  }

  /** Admin forrás-szerkeszthetőség (2026-07-28) — egy forrás kizárása a Story hitelesség-számításából, indoklással. */
  async setExcluded(
    storyId: string,
    rawArticleId: string,
    excluded: boolean,
    reason: string | null,
  ): Promise<void> {
    await this.db
      .update(storySources)
      .set({ excluded, excludedReason: excluded ? reason : null })
      .where(and(eq(storySources.storyId, storyId), eq(storySources.rawArticleId, rawArticleId)));
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
        contentOrigin: rawArticles.contentOrigin,
      })
      .from(storySources)
      .innerJoin(rawArticles, eq(storySources.rawArticleId, rawArticles.id))
      .innerJoin(sources, eq(rawArticles.sourceId, sources.id))
      .where(eq(storySources.storyId, storyId));
    return rows;
  }
}
