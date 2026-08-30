import type { Entity } from "@magyarsportonline/db";
import { describe, expect, it } from "vitest";
import { pickRelatedStories } from "./related-stories";
import type { StorySummaryView } from "./story-view";

function story(overrides: Partial<StorySummaryView>): StorySummaryView {
  return {
    id: "id",
    slug: "slug",
    title: "Title",
    lead: "Lead",
    primarySourceName: null,
    confidenceScore: 0.7,
    isDeveloping: false,
    isAiGenerated: true,
    imageUrl: null,
    publishedAt: "2026-07-28T00:00:00.000Z",
    lastUpdatedAt: "2026-07-28T00:00:00.000Z",
    versionCount: 1,
    ...overrides,
  };
}

function entity(overrides: Partial<Entity>): Entity {
  return {
    id: "e1",
    type: "team",
    nameCanonical: "name",
    nameHu: "name",
    aliases: [],
    externalRef: null,
    ...overrides,
  };
}

describe("pickRelatedStories", () => {
  it("prioritizes stories mentioning the same entity as the current story", () => {
    const current = story({ id: "current", title: "Liverpool win big", lead: "" });
    const shared = story({ id: "shared", title: "Liverpool sign new player", lead: "" });
    const unrelated = story({ id: "unrelated", title: "Tennis update", lead: "" });
    const entities = [
      entity({ id: "liverpool", nameCanonical: "Liverpool", aliases: ["Liverpool"] }),
    ];

    const result = pickRelatedStories(current, [unrelated, shared], entities);

    expect(result[0]?.id).toBe("shared");
  });

  it("never includes the current story itself", () => {
    const current = story({ id: "current" });
    const result = pickRelatedStories(current, [current], []);
    expect(result).toEqual([]);
  });

  it("pads out with other recent stories when there aren't enough entity matches", () => {
    const current = story({ id: "current", title: "Liverpool win", lead: "" });
    const others = [
      story({ id: "a", title: "Something else" }),
      story({ id: "b", title: "Another thing" }),
    ];
    const result = pickRelatedStories(current, others, []);
    expect(result.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("caps at 3 results", () => {
    const current = story({ id: "current" });
    const others = Array.from({ length: 5 }, (_, i) => story({ id: `s${i}` }));
    const result = pickRelatedStories(current, others, []);
    expect(result).toHaveLength(3);
  });
});
