import type { Entity } from "@magyarsportonline/db";
import { describe, expect, it } from "vitest";
import { buildHomepageView } from "./homepage";
import type { StorySummaryView } from "./story-view";

function story(overrides: Partial<StorySummaryView>): StorySummaryView {
  return {
    id: "id",
    slug: "slug",
    title: "Title",
    lead: "Lead",
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

describe("buildHomepageView", () => {
  it("splits stories into hero, featured (next 3), and river (the rest)", () => {
    const stories = Array.from({ length: 8 }, (_, i) =>
      story({ id: `s${i}`, title: `Story ${i}` }),
    );
    const result = buildHomepageView(stories, []);

    expect(result.hero?.id).toBe("s0");
    expect(result.featured.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(result.river.map((s) => s.id)).toEqual(["s4", "s5", "s6", "s7"]);
  });

  it("caps the ticker at 5 stories", () => {
    const stories = Array.from({ length: 8 }, (_, i) => story({ id: `s${i}` }));
    const result = buildHomepageView(stories, []);
    expect(result.ticker).toHaveLength(5);
  });

  it("returns a null hero and empty lists when there are no stories", () => {
    const result = buildHomepageView([], []);
    expect(result.hero).toBeNull();
    expect(result.featured).toEqual([]);
    expect(result.river).toEqual([]);
    expect(result.ticker).toEqual([]);
  });

  it("only includes entities actually mentioned in a story's title or lead", () => {
    const stories = [story({ title: "Liverpool beat Arsenal", lead: "A thriller at Anfield." })];
    const entities = [
      entity({ id: "liverpool", nameCanonical: "Liverpool", aliases: ["Liverpool"] }),
      entity({ id: "chelsea", nameCanonical: "Chelsea", aliases: ["Chelsea"] }),
    ];
    const result = buildHomepageView(stories, entities);
    expect(result.popularEntities.map((e) => e.id)).toEqual(["liverpool"]);
  });

  it("caps popularEntities at 8", () => {
    const stories = [story({ title: "Everyone", lead: "mentions everyone" })];
    const entities = Array.from({ length: 10 }, (_, i) =>
      entity({ id: `e${i}`, nameCanonical: "everyone", aliases: ["everyone"] }),
    );
    const result = buildHomepageView(stories, entities);
    expect(result.popularEntities).toHaveLength(8);
  });
});
