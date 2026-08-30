import type { StoryReadModelRow } from "@magyarsportonline/db";
import { z } from "zod";

const sourceSummarySchema = z.object({
  name: z.string(),
  url: z.string(),
  firstSeenAt: z.string(),
  // Optional (nem `sourceSummarySchema`-t mindenhol frissítő, régebbi
  // read-model sorok is előfordulhatnak) — a publikus oldal "n/a"-ként
  // kezeli, ha hiányzik.
  reliabilityTier: z.enum(["A", "B", "C"]).optional(),
});

const versionHistoryEntrySchema = z.object({
  version_number: z.number(),
  created_at: z.string(),
  change_summary: z.string().nullable(),
});

const credibilityHistoryEntrySchema = z.object({
  score: z.number(),
  band: z.string(),
  labelHu: z.string(),
  recordedAt: z.string(),
});

// Hitelesség-magyarázat (2026-07-28-i bővítés) — forrásonkénti bontás,
// ellentmondás-részletezés, forrásra hivatkozó pontszám-indoklás. Mind
// `.optional().default([])`, mert egy korábban projektált read-model sor
// (a bővítés előtti) még nem tartalmazza ezeket — a publikus oldal ekkor
// egyszerűen üres listaként kezeli, nem hibaként.
const sourceBreakdownItemSchema = z.object({
  sourceId: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  badgeEmoji: z.string(),
  reliabilityDisplayScore: z.number(),
  factCount: z.number(),
  factCountLabelHu: z.string(),
});

const contradictionClaimSchema = z.object({ sourceName: z.string(), detailHu: z.string() });

const contradictionDetailSchema = z.object({
  factType: z.string(),
  factTypeLabelHu: z.string(),
  claims: z.array(contradictionClaimSchema),
  statusHu: z.string(),
});

const scoreBreakdownEntrySchema = z.object({ labelHu: z.string(), points: z.number() });

const credibilitySummarySchema = z.object({
  score: z.number(),
  band: z.string().nullable(),
  labelHu: z.string().nullable(),
  justificationHu: z.string().nullable(),
  officialConfirmed: z.boolean(),
  corroboratingSourceCount: z.number().nullable(),
  updatedAt: z.string().nullable(),
  history: z.array(credibilityHistoryEntrySchema),
  sourceBreakdown: z.array(sourceBreakdownItemSchema).optional().default([]),
  contradictions: z.array(contradictionDetailSchema).optional().default([]),
  scoreBreakdown: z.array(scoreBreakdownEntrySchema).optional().default([]),
});

export interface CredibilityView {
  score: number;
  band: string | null;
  labelHu: string | null;
  justificationHu: string | null;
  officialConfirmed: boolean;
  corroboratingSourceCount: number | null;
  updatedAt: string | null;
  history: Array<{ score: number; band: string; labelHu: string; recordedAt: string }>;
  sourceBreakdown: Array<{
    sourceId: string;
    name: string;
    category: string | null;
    badgeEmoji: string;
    reliabilityDisplayScore: number;
    factCount: number;
    factCountLabelHu: string;
  }>;
  contradictions: Array<{
    factType: string;
    factTypeLabelHu: string;
    claims: Array<{ sourceName: string; detailHu: string }>;
    statusHu: string;
  }>;
  scoreBreakdown: Array<{ labelHu: string; points: number }>;
}

function parseCredibility(value: unknown): CredibilityView | null {
  if (value === null || value === undefined) {
    return null;
  }
  const result = credibilitySummarySchema.safeParse(value);
  return result.success ? result.data : null;
}

export interface StorySummaryView {
  id: string;
  slug: string;
  title: string;
  lead: string;
  primarySourceName: string | null;
  confidenceScore: number | null;
  isDeveloping: boolean;
  isAiGenerated: boolean;
  imageUrl: string | null;
  publishedAt: string;
  lastUpdatedAt: string;
  versionCount: number;
}

export interface StoryDetailView extends StorySummaryView {
  bodyHtml: string;
  metaDescription: string | null;
  sources: Array<{ name: string; url: string; firstSeenAt: string; reliabilityTier?: string }>;
  versionHistory: Array<{ versionNumber: number; createdAt: string; changeSummary: string | null }>;
  credibility: CredibilityView | null;
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
  const sources = parseSources(row.sourcesSummary);
  const versionHistory = parseVersionHistory(row.versionHistorySummary);
  return {
    id: row.storyId,
    slug: row.slug,
    title: row.titleHu,
    lead: row.leadHu,
    primarySourceName: sources[0]?.name ?? null,
    confidenceScore: row.confidenceScore === null ? null : Number(row.confidenceScore),
    isDeveloping: row.isDeveloping,
    isAiGenerated: row.isAiGenerated,
    imageUrl: row.imageUrl,
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
      ...(source.reliabilityTier ? { reliabilityTier: source.reliabilityTier } : {}),
    })),
    versionHistory: versionHistory.map((entry) => ({
      versionNumber: entry.version_number,
      createdAt: entry.created_at,
      changeSummary: entry.change_summary,
    })),
    credibility: parseCredibility(row.credibilitySummary),
  };
}
