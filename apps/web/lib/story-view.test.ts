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
    imageUrl: null,
    publishedAt: new Date("2026-07-27T21:00:00.000Z"),
    lastUpdatedAt: new Date("2026-07-27T21:05:00.000Z"),
    versionHistorySummary: [
      { version_number: 1, created_at: "2026-07-27T20:55:00.000Z", change_summary: null },
    ],
    credibilitySummary: null,
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
      imageUrl: null,
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

  it("surfaces a well-formed credibility summary, defaulting missing breakdown fields to empty arrays", () => {
    const result = toStoryDetailView(
      row({
        credibilitySummary: {
          score: 82,
          band: "strong_corroboration",
          labelHu: "Több erős forrás megerősíti",
          justificationHu: "2 független forrás egyezik meg legalább egy állításban.",
          officialConfirmed: false,
          corroboratingSourceCount: 2,
          updatedAt: "2026-07-28T10:00:00.000Z",
          history: [
            {
              score: 60,
              band: "likely",
              labelHu: "Valószínű",
              recordedAt: "2026-07-28T09:00:00.000Z",
            },
          ],
        },
      }),
    );
    expect(result.credibility).toEqual({
      score: 82,
      band: "strong_corroboration",
      labelHu: "Több erős forrás megerősíti",
      justificationHu: "2 független forrás egyezik meg legalább egy állításban.",
      officialConfirmed: false,
      corroboratingSourceCount: 2,
      updatedAt: "2026-07-28T10:00:00.000Z",
      history: [
        {
          score: 60,
          band: "likely",
          labelHu: "Valószínű",
          recordedAt: "2026-07-28T09:00:00.000Z",
        },
      ],
      sourceBreakdown: [],
      contradictions: [],
      scoreBreakdown: [],
    });
  });

  it("surfaces the full source breakdown and a contradiction detail when present", () => {
    const result = toStoryDetailView(
      row({
        credibilitySummary: {
          score: 86,
          band: "strong_corroboration",
          labelHu: "Több erős forrás megerősíti",
          justificationHu: "2 független forrás egyezik meg legalább egy állításban.",
          officialConfirmed: true,
          corroboratingSourceCount: 2,
          updatedAt: "2026-07-28T10:00:00.000Z",
          history: [],
          sourceBreakdown: [
            {
              sourceId: "bbc",
              name: "BBC Sport",
              category: "trusted_media",
              badgeEmoji: "🟢",
              reliabilityDisplayScore: 95,
              factCount: 3,
              factCountLabelHu: "3 állítás",
            },
            {
              sourceId: "club",
              name: "Liverpool FC",
              category: "club",
              badgeEmoji: "🟡",
              reliabilityDisplayScore: 100,
              factCount: 1,
              factCountLabelHu: "1 hivatalos közlemény",
            },
          ],
          contradictions: [
            {
              factType: "transfer_status",
              factTypeLabelHu: "átigazolási részlet",
              claims: [
                { sourceName: "Sky Sports", detailHu: "35 millió euróért" },
                { sourceName: "BBC Sport", detailHu: "40 millió euróért" },
              ],
              statusHu: "Nem megerősített átigazolási részlet",
            },
          ],
          scoreBreakdown: [
            { labelHu: "Hivatalos forrás megerősítette (Liverpool FC)", points: 25 },
          ],
        },
      }),
    );
    expect(result.credibility?.sourceBreakdown).toHaveLength(2);
    expect(result.credibility?.sourceBreakdown[1]).toMatchObject({
      name: "Liverpool FC",
      badgeEmoji: "🟡",
      factCountLabelHu: "1 hivatalos közlemény",
    });
    expect(result.credibility?.contradictions).toHaveLength(1);
    expect(result.credibility?.contradictions[0]?.claims).toHaveLength(2);
    expect(result.credibility?.scoreBreakdown[0]?.points).toBe(25);
  });

  it("returns null credibility when the summary is null or malformed", () => {
    expect(toStoryDetailView(row({ credibilitySummary: null })).credibility).toBeNull();
    expect(
      toStoryDetailView(row({ credibilitySummary: { nonsense: true } })).credibility,
    ).toBeNull();
  });
});
