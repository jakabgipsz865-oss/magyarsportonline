import { schema, type Database } from "@magyarsportonline/db";
import { desc, eq } from "drizzle-orm";

export interface SourceSummary {
  name: string;
  url: string;
  firstSeenAt: string;
}

export interface VersionHistoryEntry {
  versionNumber: number;
  createdAt: string;
  changeSummary: string | null;
}

export interface PublishedStorySummary {
  slug: string;
  titleHu: string;
  leadHu: string;
  confidenceScore: number | null;
  publishedAt: Date;
  lastUpdatedAt: Date;
}

export interface PublishedStoryDetail extends PublishedStorySummary {
  bodyHtml: string;
  isDeveloping: boolean;
  sourcesSummary: SourceSummary[];
  versionHistory: VersionHistoryEntry[];
}

/**
 * Reads ONLY `story_read_model` (the CQRS projection maintained by
 * @magyarsportonline/agents' read-model projector) — never the write-side
 * `stories`/`story_versions` tables. This is the whole point of the CQRS
 * split (docs/architecture/09-architecture-review.md §5): the public site's
 * read traffic never contends with the agent pipeline's writes.
 */
export async function listPublishedStories(
  db: Database,
  limit = 20,
): Promise<PublishedStorySummary[]> {
  const rows = await db
    .select({
      slug: schema.storyReadModel.slug,
      titleHu: schema.storyReadModel.titleHu,
      leadHu: schema.storyReadModel.leadHu,
      confidenceScore: schema.storyReadModel.confidenceScore,
      publishedAt: schema.storyReadModel.publishedAt,
      lastUpdatedAt: schema.storyReadModel.lastUpdatedAt,
    })
    .from(schema.storyReadModel)
    .orderBy(desc(schema.storyReadModel.lastUpdatedAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    confidenceScore: row.confidenceScore !== null ? Number(row.confidenceScore) : null,
  }));
}

export async function getPublishedStoryBySlug(
  db: Database,
  slug: string,
): Promise<PublishedStoryDetail | null> {
  const row = await db.query.storyReadModel.findFirst({
    where: eq(schema.storyReadModel.slug, slug),
  });
  if (!row) {
    return null;
  }

  return {
    slug: row.slug,
    titleHu: row.titleHu,
    leadHu: row.leadHu,
    bodyHtml: row.bodyHtml,
    confidenceScore: row.confidenceScore !== null ? Number(row.confidenceScore) : null,
    isDeveloping: row.isDeveloping,
    publishedAt: row.publishedAt,
    lastUpdatedAt: row.lastUpdatedAt,
    sourcesSummary: (row.sourcesSummary ?? []) as SourceSummary[],
    versionHistory: (row.versionHistorySummary ?? []) as VersionHistoryEntry[],
  };
}
