import { describe, expect, it } from "vitest";
import { findSimilarCorrections, jaccardSimilarity, tokenize } from "./correction-similarity";
import type { EditorialCorrection } from "./editorial-corrections";

function correction(overrides: Partial<EditorialCorrection> = {}): EditorialCorrection {
  return {
    id: "correction-1",
    category: "style",
    termEn: null,
    originalSentenceEn: "The manager praised the team's effort.",
    currentSentenceHu: "A menedzser dicsérte a csapat erőfeszítését.",
    correctedSentenceHu: "A vezetőedző elismerően nyilatkozott a csapat teljesítményéről.",
    note: null,
    ...overrides,
  };
}

describe("tokenize", () => {
  it("lowercases, strips punctuation, and splits into words", () => {
    expect(tokenize("A menedzser dicsérte a csapat erőfeszítését.")).toEqual([
      "menedzser",
      "dicsérte",
      "csapat",
      "erőfeszítését",
    ]);
  });

  it("drops common Hungarian stopwords and single-character fragments", () => {
    expect(tokenize("a és de nem meg")).toEqual([]);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 1 for identical token sets", () => {
    expect(jaccardSimilarity(["gólos", "dráma"], ["gólos", "dráma"])).toBe(1);
  });

  it("returns 0 for completely disjoint token sets", () => {
    expect(jaccardSimilarity(["gólos", "dráma"], ["kapus", "hiba"])).toBe(0);
  });

  it("returns 0 when either set is empty", () => {
    expect(jaccardSimilarity([], ["gólos"])).toBe(0);
    expect(jaccardSimilarity(["gólos"], [])).toBe(0);
  });

  it("returns a partial score for a partial overlap", () => {
    const score = jaccardSimilarity(["gólos", "dráma", "nyert"], ["gólos", "dráma", "vesztett"]);
    // intersection = 2 (gólos, dráma), union = 4 -> 0.5
    expect(score).toBe(0.5);
  });
});

describe("findSimilarCorrections", () => {
  it("finds a correction with substantially overlapping wording", () => {
    const matches = findSimilarCorrections("A menedzser dicsérte a játékosok erőfeszítését.", [
      correction(),
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.correction.correctedSentenceHu).toContain("vezetőedző");
  });

  it("excludes matches below the minimum score threshold", () => {
    const matches = findSimilarCorrections("Teljesen más témájú mondat egy meccsről.", [
      correction(),
    ]);
    expect(matches).toEqual([]);
  });

  it("sorts by descending similarity score", () => {
    const weakMatch = correction({
      id: "weak",
      currentSentenceHu: "A csapat erőfeszítést tett a győzelemért.",
    });
    const strongMatch = correction({
      id: "strong",
      currentSentenceHu: "A menedzser dicsérte a csapat erőfeszítését ma este.",
    });
    const matches = findSimilarCorrections("A menedzser dicsérte a csapat erőfeszítését.", [
      weakMatch,
      strongMatch,
    ]);
    expect(matches[0]?.correction.id).toBe("strong");
  });

  it("respects the limit parameter", () => {
    const corrections = Array.from({ length: 5 }, (_, i) =>
      correction({
        id: `c${i}`,
        currentSentenceHu: "A menedzser dicsérte a csapat erőfeszítését.",
      }),
    );
    const matches = findSimilarCorrections(
      "A menedzser dicsérte a csapat erőfeszítését.",
      corrections,
      2,
    );
    expect(matches).toHaveLength(2);
  });

  it("returns an empty array when the target sentence has no meaningful tokens", () => {
    expect(findSimilarCorrections("a és de", [correction()])).toEqual([]);
  });
});
