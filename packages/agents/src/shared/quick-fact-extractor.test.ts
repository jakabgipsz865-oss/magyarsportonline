import { describe, expect, it } from "vitest";
import { extractQuickFacts } from "./quick-fact-extractor.js";

describe("extractQuickFacts", () => {
  it("extracts a score fact from a result-like sentence", () => {
    const facts = extractQuickFacts("A Duna FC 2-1-re gyozott a Tisza SE ellen.");
    const score = facts.find((f) => f.factType === "score");
    expect(score?.payload).toMatchObject({ home: 2, away: 1 });
  });

  it("extracts a quote fact from double-quoted text", () => {
    const facts = extractQuickFacts('Kovacs Andras azt mondta: "Elegedett vagyok a csapattal."');
    const quote = facts.find((f) => f.factType === "quote");
    expect(quote?.payload).toMatchObject({ text: "Elegedett vagyok a csapattal." });
  });

  it("returns both facts when both are present", () => {
    const facts = extractQuickFacts(
      'Vegeredmeny: Duna FC 2-1 Tisza SE. Az edzo szerint: "jo volt a csapat".',
    );
    expect(facts.map((f) => f.factType).sort()).toEqual(["quote", "score"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(extractQuickFacts("Nincs itt semmi konkretum.")).toEqual([]);
  });
});
