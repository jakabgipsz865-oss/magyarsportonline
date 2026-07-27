import { schema, type Database } from "@magyarsportonline/db";
import type { SourceReliabilityTier } from "@magyarsportonline/shared";
import { eq } from "drizzle-orm";

export interface ContributingSource {
  sourceId: string;
  reliabilityTier: SourceReliabilityTier;
}

/**
 * Distinct Sources that have contributed a RawArticle to a Story, via the
 * story_sources -> raw_articles -> sources join chain. Shared between the
 * Story Merge Agent (corroboration-only confidence bump) and the Fact
 * Verification Agent (full confidence recompute) so the two never compute
 * "independent source count" differently.
 */
export async function getContributingSources(
  db: Pick<Database, "select">,
  storyId: string,
): Promise<ContributingSource[]> {
  const rows = await db
    .select({
      sourceId: schema.sources.id,
      reliabilityTier: schema.sources.reliabilityTier,
    })
    .from(schema.storySources)
    .innerJoin(schema.rawArticles, eq(schema.storySources.rawArticleId, schema.rawArticles.id))
    .innerJoin(schema.sources, eq(schema.rawArticles.sourceId, schema.sources.id))
    .where(eq(schema.storySources.storyId, storyId));

  const distinct = new Map<string, SourceReliabilityTier>();
  for (const row of rows) {
    distinct.set(row.sourceId, row.reliabilityTier);
  }
  return [...distinct.entries()].map(([sourceId, reliabilityTier]) => ({
    sourceId,
    reliabilityTier,
  }));
}
