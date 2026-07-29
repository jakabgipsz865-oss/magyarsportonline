import type { Entity } from "@magyarsportonline/db";
import { describe, expect, it } from "vitest";
import { extractEntityMentions, extractLead } from "./entity-mentions";

function entity(overrides: Partial<Entity>): Entity {
  return {
    id: "id",
    type: "team",
    nameCanonical: "name",
    nameHu: "name",
    aliases: [],
    externalRef: null,
    ...overrides,
  };
}

const LIVERPOOL = entity({
  id: "liverpool",
  nameCanonical: "Liverpool FC",
  aliases: ["Liverpool"],
});
const ARSENAL = entity({ id: "arsenal", nameCanonical: "Arsenal FC", aliases: ["Arsenal"] });
const PREMIER_LEAGUE = entity({
  id: "pl",
  type: "competition",
  nameCanonical: "Premier League",
});

describe("extractLead", () => {
  it("prefers the extractor-provided subtitle when present", () => {
    const lead = extractLead({
      titleOriginal: "Title",
      subtitleOriginal: "The real lead paragraph.",
      bodyOriginal: "Some other body text.",
    });
    expect(lead).toBe("The real lead paragraph.");
  });

  it("falls back to the first body paragraph when there is no subtitle", () => {
    const lead = extractLead({
      titleOriginal: "Title",
      subtitleOriginal: null,
      bodyOriginal: "First real paragraph.\n\nSecond paragraph.",
    });
    expect(lead).toBe("First real paragraph.");
  });

  it("skips a leading boilerplate/CTA paragraph and uses the next real one as the lead", () => {
    const lead = extractLead({
      titleOriginal: "Title",
      subtitleOriginal: null,
      bodyOriginal:
        "Watch Premier League and more with NOW - contract free\n\nThe actual first real sentence of the article.",
    });
    expect(lead).toBe("The actual first real sentence of the article.");
  });
});

describe("extractEntityMentions", () => {
  it("finds a specific team entity mentioned in the title", () => {
    const mentions = extractEntityMentions(
      {
        titleOriginal: "Liverpool beat Arsenal 3-1",
        subtitleOriginal: null,
        bodyOriginal: "body",
      },
      [LIVERPOOL, ARSENAL],
    );
    expect(mentions).toEqual(
      expect.arrayContaining([
        {
          entity: { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
          location: "title",
        },
        {
          entity: { entityId: "arsenal", type: "team", nameCanonical: "Arsenal FC" },
          location: "title",
        },
      ]),
    );
  });

  it("never scans the full body — an entity only present deep in the body is not returned", () => {
    const mentions = extractEntityMentions(
      {
        titleOriginal: "Darts: Henry Coates wins maiden tournament",
        subtitleOriginal: null,
        bodyOriginal:
          "Coates beat Damon Heta in the final.\n\nWatch Premier League and more with NOW - contract free",
      },
      [PREMIER_LEAGUE],
    );
    expect(mentions).toEqual([]);
  });

  it("does not let a boilerplate CTA paragraph leak into the derived lead", () => {
    const mentions = extractEntityMentions(
      {
        titleOriginal: "Darts: Henry Coates wins maiden tournament",
        subtitleOriginal: null,
        bodyOriginal:
          "Watch Premier League and more with NOW - contract free\n\nCoates beat Damon Heta in the final.",
      },
      [PREMIER_LEAGUE],
    );
    expect(mentions).toEqual([]);
  });

  it("marks an entity found in the lead (not the title) with location=lead", () => {
    const mentions = extractEntityMentions(
      {
        titleOriginal: "Match report",
        subtitleOriginal: "Arsenal fell to defeat at Anfield.",
        bodyOriginal: "body",
      },
      [ARSENAL],
    );
    expect(mentions).toEqual([
      {
        entity: { entityId: "arsenal", type: "team", nameCanonical: "Arsenal FC" },
        location: "lead",
      },
    ]);
  });

  it("prefers title location when an entity appears in both title and lead", () => {
    const mentions = extractEntityMentions(
      {
        titleOriginal: "Arsenal win again",
        subtitleOriginal: "Arsenal continue their fine form.",
        bodyOriginal: "body",
      },
      [ARSENAL],
    );
    expect(mentions).toEqual([
      {
        entity: { entityId: "arsenal", type: "team", nameCanonical: "Arsenal FC" },
        location: "title",
      },
    ]);
  });
});
