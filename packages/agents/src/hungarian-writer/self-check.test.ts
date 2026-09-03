import { describe, expect, it } from "vitest";
import type { WriterFact } from "./facts";
import type { WriterSentenceProvenance } from "./generation";
import { validateGeneratedProvenance } from "./self-check";

const FACTS: WriterFact[] = [
  {
    id: "fact-1",
    isContradicted: false,
    factType: "transfer_status",
    claimEn: "Manchester United spent £155 million on 3 September 2026 before the 11pm deadline.",
    evidenceOriginal:
      "Manchester United spent £155 million on 3 September 2026 before the 11pm deadline.",
    subject: "Manchester United",
    predicate: "transfer_spend",
    normalizedValue: "155 GBP million",
    eventTimeIso: "2026-09-03T23:00:00Z",
    sourcePublishedAt: null,
    quoteOriginal: null,
    quoteSpeaker: null,
  },
  {
    id: "fact-2",
    isContradicted: false,
    factType: "quote",
    claimEn: "Erik ten Hag said: We are ready.",
    evidenceOriginal: 'Erik ten Hag said: "We are ready."',
    subject: "Erik ten Hag",
    predicate: "statement",
    normalizedValue: null,
    eventTimeIso: null,
    sourcePublishedAt: null,
    quoteOriginal: "We are ready.",
    quoteSpeaker: "Erik ten Hag",
  },
];

function provenance(): WriterSentenceProvenance[] {
  return [
    {
      sentenceId: "T1",
      section: "title",
      text: "Manchester United: 155 millió fontot költött a klub",
      supportingFactIds: ["fact-1"],
    },
    {
      sentenceId: "L1",
      section: "lead",
      text: "A Manchester United szeptember 3-án zárta le az üzleteket.",
      supportingFactIds: ["fact-1"],
    },
    {
      sentenceId: "B1",
      section: "body",
      text: "A határidő 23:00 órakor járt le.",
      supportingFactIds: ["fact-1"],
    },
    {
      sentenceId: "B2",
      section: "body",
      text: 'Erik ten Hag kijelentette: "We are ready."',
      supportingFactIds: ["fact-2"],
    },
    {
      sentenceId: "B3",
      section: "body",
      text: "Erik ten Hag nyilatkozott a helyzetről.",
      supportingFactIds: ["fact-2"],
    },
  ];
}

describe("validateGeneratedProvenance", () => {
  it("computes 1.0 when all 5 structured sentences pass", () => {
    const result = validateGeneratedProvenance({ facts: FACTS, sentenceProvenance: provenance() });

    expect(result.consistent).toBe(true);
    expect(result.factConsistencyScore).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it("computes 0.8 and audits the exact unsupported sentence", () => {
    const sentences = provenance();
    sentences[4] = { ...sentences[4]!, text: "Erik ten Hag 200 millió fontot költött." };

    const result = validateGeneratedProvenance({ facts: FACTS, sentenceProvenance: sentences });

    expect(result.consistent).toBe(false);
    expect(result.factConsistencyScore).toBe(0.8);
    expect(result.sentenceVerdicts[4]).toMatchObject({
      sentenceId: "B3",
      supported: false,
      supportingFactIds: ["fact-2"],
      issue: expect.stringContaining("unsupported_number_or_time"),
    });
  });

  it("fails closed for missing Fact provenance or an unknown Fact ID", () => {
    const sentences = provenance();
    sentences[0] = { ...sentences[0]!, supportingFactIds: [] };
    sentences[1] = { ...sentences[1]!, supportingFactIds: ["missing"] };

    const result = validateGeneratedProvenance({ facts: FACTS, sentenceProvenance: sentences });

    expect(result.consistent).toBe(false);
    expect(result.sentenceVerdicts[0]?.issue).toContain("missing_fact_provenance");
    expect(result.sentenceVerdicts[1]?.issue).toContain("unknown_fact_id");
  });

  it("rejects contradicted Facts, unsupported names and non-exact direct quotes", () => {
    const facts = [{ ...FACTS[0]!, isContradicted: true }, FACTS[1]!];
    const sentences = provenance();
    sentences[0] = { ...sentences[0]!, supportingFactIds: ["fact-1"] };
    sentences[3] = {
      ...sentences[3]!,
      text: 'Erik ten Hag kijelentette: "We will definitely win."',
    };
    sentences[4] = { ...sentences[4]!, text: "Erik ten Hag és Pep Guardiola nyilatkozott." };

    const result = validateGeneratedProvenance({ facts, sentenceProvenance: sentences });

    expect(result.sentenceVerdicts[0]?.issue).toContain("contradicted_fact_used");
    expect(result.sentenceVerdicts[3]?.issue).toContain("unsupported_direct_quote");
    expect(result.sentenceVerdicts[4]?.issue).toContain("unsupported_explicit_name");
  });

  it("allows a Hungarian paraphrase of an English quote without quotation marks", () => {
    const sentences = provenance();
    sentences[3] = {
      ...sentences[3]!,
      text: "Erik ten Hag szerint a csapat készen áll.",
    };

    const result = validateGeneratedProvenance({ facts: FACTS, sentenceProvenance: sentences });

    expect(result.sentenceVerdicts[3]).toMatchObject({ supported: true, issue: null });
  });

  it("rejects a translated Hungarian direct quote", () => {
    const sentences = provenance();
    sentences[3] = {
      ...sentences[3]!,
      text: "Erik ten Hag kijelentette: „Készen állunk.”",
    };

    const result = validateGeneratedProvenance({ facts: FACTS, sentenceProvenance: sentences });

    expect(result.sentenceVerdicts[3]?.issue).toContain("unsupported_direct_quote");
  });

  it("rejects non-sequential sentence IDs deterministically", () => {
    const sentences = provenance();
    sentences[4] = { ...sentences[4]!, sentenceId: "B4" };

    const result = validateGeneratedProvenance({ facts: FACTS, sentenceProvenance: sentences });

    expect(result.consistent).toBe(false);
    expect(result.sentenceVerdicts[4]?.issue).toContain("invalid_sentence_id");
  });
});
