import type { StoryReadModelRow } from "@magyarsportonline/db";
import { describe, expect, it } from "vitest";
import { toStoryDetailView, toStorySummaryView } from "./story-view";

function row(overrides?: Partial<StoryReadModelRow>): StoryReadModelRow {
  return {
    storyId: "story-1",
    slug: "liverpool-nyert",
    titleHu: "Liverpool nyert",
    leadHu: "Lead szöveg.",
    bodyHtml: "<p>Törzs.</p>",
    metaDescription: null,
    structuredData: null,
    sourcesSummary: [
      {
        name: "BBC Sport - Football",
        url: "https://example.com/1",
        firstSeenAt: "2026-07-27T20:00:00.000Z",
      },
    ],
    tags: [],
    category: null,
    confidenceScore: "0.700",
    isDeveloping: false,
    isAiGenerated: true,
    publishedAt: new Date("2026-07-27T21:00:00.000Z"),
    lastUpdatedAt: new Date("2026-07-27T21:05:00.000Z"),
    versionHistorySummary: [
      { version_number: 1, created_at: "2026-07-27T20:55:00.000Z", change_summary: null },
    ],
    ...overrides,
  };
}

describe("toStorySummaryView", () => {
  it("maps the read model row into the public summary shape", () => {
    expect(toStorySummaryView(row())).toEqual({
      id: "story-1",
      slug: "liverpool-nyert",
      title: "Liverpool nyert",
      lead: "Lead szöveg.",
      confidenceScore: 0.7,
      isDeveloping: false,
      isAiGenerated: true,
      publishedAt: "2026-07-27T21:00:00.000Z",
      lastUpdatedAt: "2026-07-27T21:05:00.000Z",
      versionCount: 1,
    });
  });

  it("falls back to an empty version history on malformed jsonb", () => {
    const result = toStorySummaryView(row({ versionHistorySummary: "not-an-array" }));
    expect(result.versionCount).toBe(0);
  });

  it("passes through a null confidence score", () => {
    const result = toStorySummaryView(row({ confidenceScore: null }));
    expect(result.confidenceScore).toBeNull();
  });

  it("passes through isAiGenerated=false (no-LLM passthrough content)", () => {
    const result = toStorySummaryView(row({ isAiGenerated: false }));
    expect(result.isAiGenerated).toBe(false);
  });
});

describe("toStoryDetailView", () => {
  it("includes sources and version history alongside the summary fields", () => {
    const result = toStoryDetailView(row());
    expect(result.bodyHtml).toBe("<p>Törzs.</p>");
    expect(result.sources).toEqual([
      {
        name: "BBC Sport - Football",
        url: "https://example.com/1",
        firstSeenAt: "2026-07-27T20:00:00.000Z",
      },
    ]);
    expect(result.versionHistory).toEqual([
      { versionNumber: 1, createdAt: "2026-07-27T20:55:00.000Z", changeSummary: null },
    ]);
  });

  it("drops malformed source entries instead of throwing", () => {
    const result = toStoryDetailView(row({ sourcesSummary: [{ missing: "fields" }] }));
    expect(result.sources).toEqual([]);
  });
});
