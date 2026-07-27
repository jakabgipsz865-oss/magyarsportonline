import type { Fact } from "@magyarsportonline/db";
import { describe, expect, it } from "vitest";
import { toWriterFact } from "./facts";

function fact(payload: unknown): Fact {
  return {
    id: "fact-1",
    storyId: "story-1",
    rawArticleId: "raw-1",
    factType: "score",
    payload,
    corroborationCount: 1,
    isContradicted: false,
    extractedAt: new Date(),
  };
}

describe("toWriterFact", () => {
  it("extracts detail/quote fields from the extraction-shaped payload", () => {
    const result = toWriterFact(
      fact({
        detail_hu: "3-1 Liverpool javára",
        quote_original: "Great win",
        quote_speaker: "Coach",
      }),
    );
    expect(result).toEqual({
      factType: "score",
      detailHu: "3-1 Liverpool javára",
      quoteOriginal: "Great win",
      quoteSpeaker: "Coach",
    });
  });

  it("defaults to null/empty for a malformed payload instead of throwing", () => {
    const result = toWriterFact(fact({ unexpected: true }));
    expect(result).toEqual({
      factType: "score",
      detailHu: "",
      quoteOriginal: null,
      quoteSpeaker: null,
    });
  });
});
