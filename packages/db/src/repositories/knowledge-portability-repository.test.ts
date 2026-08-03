import { describe, expect, it } from "vitest";
import {
  containsKnowledgeRedaction,
  KNOWLEDGE_REDACTION_MARKER,
  normalizePortableSourceIdentity,
  portableEditorialCorrectionKey,
  restoreKnowledgeRedactions,
} from "./knowledge-portability-repository";

describe("knowledge portability secret handling", () => {
  it("preserves the target environment secret while importing public settings", () => {
    expect(
      restoreKnowledgeRedactions(
        {
          url: "https://example.com/feed",
          headers: { authorization: KNOWLEDGE_REDACTION_MARKER, accept: "application/json" },
        },
        {
          url: "https://old.example.com/feed",
          headers: { authorization: "Bearer target-secret", accept: "text/xml" },
        },
      ),
    ).toEqual({
      url: "https://example.com/feed",
      headers: { authorization: "Bearer target-secret", accept: "application/json" },
    });
  });

  it("keeps an unrestorable marker visible for a new source", () => {
    const imported = { apiKey: KNOWLEDGE_REDACTION_MARKER };
    expect(containsKnowledgeRedaction(imported)).toBe(true);
    expect(restoreKnowledgeRedactions(imported, undefined)).toEqual(imported);
  });

  it("keeps separately named feeds distinct even on the same base URL", () => {
    expect(normalizePortableSourceIdentity("Football feed", "https://example.com/")).not.toBe(
      normalizePortableSourceIdentity("Transfer feed", "https://example.com"),
    );
    expect(normalizePortableSourceIdentity(" Football feed ", "https://EXAMPLE.com/")).toBe(
      normalizePortableSourceIdentity("football FEED", "https://example.com"),
    );
  });

  it("builds a deterministic portable key for an editorial correction", () => {
    const correction = {
      category: "terminology" as const,
      termEn: "super-sub",
      originalSentenceEn: "The super-sub scored.",
      currentSentenceHu: "A szuper csere betalált.",
      correctedSentenceHu: "A csereember betalált.",
      note: null,
    };
    expect(portableEditorialCorrectionKey(correction)).toBe(
      portableEditorialCorrectionKey({ ...correction }),
    );
    expect(
      portableEditorialCorrectionKey({ ...correction, correctedSentenceHu: "A joker betalált." }),
    ).not.toBe(portableEditorialCorrectionKey(correction));
  });
});
