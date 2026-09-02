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
    excluded: false,
    excludedReason: null,
    extractedAt: new Date(),
  };
}

describe("toWriterFact", () => {
  it("extracts the source-grounded English contract", () => {
    const result = toWriterFact(
      fact({
        claim_en: "Liverpool won 3-1",
        evidence_original: "Liverpool won 3-1 at Anfield",
        subject: "Liverpool",
        predicate: "final_score",
        normalized_value: "3-1",
        event_time_iso: null,
        source_published_at: "2026-08-30T10:00:00.000Z",
        quote_original: "Great win",
        quote_speaker: "Coach",
      }),
    );
    expect(result).toEqual({
      id: "fact-1",
      factType: "score",
      claimEn: "Liverpool won 3-1",
      evidenceOriginal: "Liverpool won 3-1 at Anfield",
      subject: "Liverpool",
      predicate: "final_score",
      normalizedValue: "3-1",
      eventTimeIso: null,
      sourcePublishedAt: "2026-08-30T10:00:00.000Z",
      quoteOriginal: "Great win",
      quoteSpeaker: "Coach",
    });
  });

  it("defaults to null/empty for a malformed payload instead of throwing", () => {
    const result = toWriterFact(fact({ unexpected: true }));
    expect(result).toEqual({
      id: "fact-1",
      factType: "score",
      claimEn: "",
      evidenceOriginal: "",
      subject: "",
      predicate: "",
      normalizedValue: null,
      eventTimeIso: null,
      sourcePublishedAt: null,
      quoteOriginal: null,
      quoteSpeaker: null,
    });
  });
});
