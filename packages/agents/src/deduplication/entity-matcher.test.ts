import { describe, expect, it } from "vitest";
import { entityMatchesText, matchPrimaryEntity } from "./entity-matcher";

type TestEntity = Parameters<typeof matchPrimaryEntity>[1][number];

function entity(overrides: Partial<TestEntity>): TestEntity {
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

describe("matchPrimaryEntity", () => {
  it("matches on the canonical name (case-insensitive)", () => {
    const entities = [entity({ id: "1", nameCanonical: "liverpool fc" })];
    const result = matchPrimaryEntity("Liverpool FC beat City 3-1", entities);
    expect(result).toEqual({ entityId: "1", type: "team", nameCanonical: "liverpool fc" });
  });

  it("matches on an alias", () => {
    const entities = [
      entity({ id: "1", nameCanonical: "Manchester United FC", aliases: ["Man Utd"] }),
    ];
    const result = matchPrimaryEntity("Man Utd win again", entities);
    expect(result?.entityId).toBe("1");
  });

  it("prefers a team match over a competition match", () => {
    const entities = [
      entity({ id: "comp", type: "competition", nameCanonical: "Premier League" }),
      entity({ id: "team", type: "team", nameCanonical: "Arsenal FC", aliases: ["Arsenal"] }),
    ];
    const result = matchPrimaryEntity("Arsenal top the Premier League", entities);
    expect(result?.entityId).toBe("team");
  });

  it("returns null when nothing matches", () => {
    const entities = [entity({ id: "1", nameCanonical: "Liverpool FC" })];
    expect(matchPrimaryEntity("A story about tennis", entities)).toBeNull();
  });
});

describe("entityMatchesText", () => {
  it("matches on the canonical name, case-insensitively", () => {
    const e = entity({ nameCanonical: "Liverpool FC" });
    expect(entityMatchesText(e, "liverpool fc win again")).toBe(true);
  });

  it("matches on an alias", () => {
    const e = entity({ nameCanonical: "Tottenham Hotspur FC", aliases: ["Tottenham", "Spurs"] });
    expect(entityMatchesText(e, "Spurs sack their manager")).toBe(true);
  });

  it("returns false when neither the name nor an alias appears", () => {
    const e = entity({ nameCanonical: "Arsenal FC", aliases: ["Arsenal"] });
    expect(entityMatchesText(e, "Chelsea win the derby")).toBe(false);
  });
});
