import type { StoryReadModelRow } from "@magyarsportonline/db";
import { z } from "zod";

const sourceSummarySchema = z.object({
  name: z.string(),
  url: z.string(),
  firstSeenAt: z.string(),
});

const versionHistoryEntrySchema = z.object({
  version_number: z.number(),
  created_at: z.string(),
  change_summary: z.string().nullable(),
});

export interface StorySummaryView {
  id: string;
  slug: string;
  title: string;
  lead: string;
  confidenceScore: number | null;
  isDeveloping: boolean;
  isAiGenerated: boolean;
  publishedAt: string;
  lastUpdatedAt: string;
  versionCount: number;
}

export interface StoryDetailView extends StorySummaryView {
  bodyHtml: string;
  metaDescription: string | null;
  sources: Array<{ name: string; url: string; firstSeenAt: string }>;
  versionHistory: Array<{ versionNumber: number; createdAt: string; changeSummary: string | null }>;
}

function parseSources(value: unknown): z.infer<typeof sourceSummarySchema>[] {
  const result = z.array(sourceSummarySchema).safeParse(value);
  return result.success ? result.data : [];
}

function parseVersionHistory(value: unknown): z.infer<typeof versionHistoryEntrySchema>[] {
  const result = z.array(versionHistoryEntrySchema).safeParse(value);
  return result.success ? result.data : [];
}

/** `story_read_model` → the public `/api/v1/stories` list item shape (docs/architecture/04-api-spec.md §4.1). */
export function toStorySummaryView(row: StoryReadModelRow): StorySummaryView {
  const versionHistory = parseVersionHistory(row.versionHistorySummary);
  return {
    id: row.storyId,
    slug: row.slug,
    title: row.titleHu,
    lead: row.leadHu,
    confidenceScore: row.confidenceScore === null ? null : Number(row.confidenceScore),
    isDeveloping: row.isDeveloping,
    isAiGenerated: row.isAiGenerated,
    publishedAt: row.publishedAt.toISOString(),
    lastUpdatedAt: row.lastUpdatedAt.toISOString(),
    versionCount: versionHistory.length,
  };
}

/** `story_read_model` → the `/hir/[slug]` page's and `/api/v1/stories/{slug}`'s shape, including the version Timeline. */
export function toStoryDetailView(row: StoryReadModelRow): StoryDetailView {
  const sources = parseSources(row.sourcesSummary);
  const versionHistory = parseVersionHistory(row.versionHistorySummary);
  return {
    ...toStorySummaryView(row),
    bodyHtml: row.bodyHtml,
    metaDescription: row.metaDescription,
    sources: sources.map((source) => ({
      name: source.name,
      url: source.url,
      firstSeenAt: source.firstSeenAt,
    })),
    versionHistory: versionHistory.map((entry) => ({
      versionNumber: entry.version_number,
      createdAt: entry.created_at,
      changeSummary: entry.change_summary,
    })),
  };
}
