import { describe, expect, it } from "vitest";
import { auditStoryMerge, type ArticleForMergeAudit } from "./merge-audit";

const LIVERPOOL_ENTITY = {
  id: "team-liverpool",
  type: "team",
  nameCanonical: "Liverpool FC",
  aliases: ["Liverpool"],
} as never;

const ARSENAL_ENTITY = {
  id: "team-arsenal",
  type: "team",
  nameCanonical: "Arsenal FC",
  aliases: ["Arsenal"],
} as never;

const GITTENS_ENTITY = {
  id: "player-gittens",
  type: "player",
  nameCanonical: "Jamie Gittens",
  aliases: ["Gittens"],
} as never;

function article(overrides: Partial<ArticleForMergeAudit>): ArticleForMergeAudit {
  return {
    sourceName: "BBC Sport - Football",
    sourceUrl: "https://example.com/1",
    titleOriginal: "Liverpool beat Arsenal 3-1",
    bodyOriginal: "Liverpool won 3-1 against Arsenal.",
    publishedAtSource: new Date("2026-07-28T10:00:00.000Z"),
    ingestedAt: new Date("2026-07-28T10:05:00.000Z"),
    ...overrides,
  };
}

describe("auditStoryMerge", () => {
  it("agrees on entity and date bucket when both articles genuinely describe the same event", () => {
    const result = auditStoryMerge(
      [
        article({ sourceName: "BBC Sport - Football", sourceUrl: "https://bbc.example/1" }),
        article({
          sourceName: "Sky Sports - Football",
          sourceUrl: "https://sky.example/1",
          publishedAtSource: new Date("2026-07-28T10:30:00.000Z"),
        }),
      ],
      [LIVERPOOL_ENTITY, ARSENAL_ENTITY],
    );

    expect(result.agreesOnEntity).toBe(true);
    expect(result.agreesOnDateBucket).toBe(true);
    expect(result.sharedEntity?.nameCanonical).toBe("Liverpool FC");
    expect(result.sharedDateBucket).toBe("2026-07-28");
    expect(result.explanationHu).toContain("Liverpool FC");
    expect(result.explanationHu).not.toContain("FIGYELEM");
  });

  it("flags disagreement when the recomputed primary entity differs (possible false-positive merge)", () => {
    const result = auditStoryMerge(
      [
        article({
          titleOriginal: "Liverpool sign new keeper",
          bodyOriginal: "Liverpool announcement.",
        }),
        article({
          sourceName: "Sky Sports - Football",
          titleOriginal: "Gittens close to Chelsea move",
          bodyOriginal:
            "Gittens transfer news, an unrelated story about a different club entirely.",
        }),
      ],
      [LIVERPOOL_ENTITY, GITTENS_ENTITY],
    );

    expect(result.agreesOnEntity).toBe(false);
    expect(result.explanationHu).toContain("FIGYELEM");
  });

  it("flags disagreement when the date bucket differs (published on different UTC days)", () => {
    const result = auditStoryMerge(
      [
        article({ publishedAtSource: new Date("2026-07-28T23:50:00.000Z") }),
        article({ publishedAtSource: new Date("2026-07-29T00:10:00.000Z") }),
      ],
      [LIVERPOOL_ENTITY, ARSENAL_ENTITY],
    );

    expect(result.agreesOnDateBucket).toBe(false);
    expect(result.explanationHu).toContain("napi blokk");
  });

  it("falls back to ingestedAt when publishedAtSource is null", () => {
    const result = auditStoryMerge(
      [article({ publishedAtSource: null, ingestedAt: new Date("2026-07-28T12:00:00.000Z") })],
      [LIVERPOOL_ENTITY],
    );

    expect(result.articles[0]?.dateBucket).toBe("2026-07-28");
    expect(result.articles[0]?.publishedAtSource).toBeNull();
  });
});
