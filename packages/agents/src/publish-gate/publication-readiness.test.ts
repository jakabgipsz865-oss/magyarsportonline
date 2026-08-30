import { describe, expect, it } from "vitest";
import { assessPublicationReadiness } from "./publication-readiness";

const SAFE_INPUT = {
  titleHu: "Anglia bronzérmes lett a világbajnokságon",
  leadHu: "Anglia tízgólos mérkőzésen 6-4-re legyőzte Franciaországot.",
  bodyHu:
    "Bukayo Saka mesterhármast szerzett a bronzmérkőzésen, az angol válogatott pedig a fordulatos találkozó végén megőrizte kétgólos előnyét.",
  facts: [
    {
      factType: "score",
      detailHu: "Anglia 6-4-re legyőzte Franciaországot.",
      quoteOriginal: null,
      quoteSpeaker: null,
    },
  ],
  isAiGenerated: true,
  factConsistencyScore: 1,
  selfCheckFallback: false,
  credibilityScore: 62,
  sourceCount: 1,
  fullArticleSourceCount: 1,
};

describe("assessPublicationReadiness", () => {
  it("passes a current, Hungarian, sourced and fact-checked draft", () => {
    expect(assessPublicationReadiness(SAFE_INPUT)).toEqual({
      passed: true,
      blockers: [],
      qualityIssues: [],
    });
  });

  it("blocks a fallback-generated draft even if its visible text looks Hungarian", () => {
    const result = assessPublicationReadiness({ ...SAFE_INPUT, isAiGenerated: false });
    expect(result.blockers).toContainEqual({ kind: "fallback_generation" });
  });

  it("blocks a fallback self-check even when its synthetic score is perfect", () => {
    const result = assessPublicationReadiness({
      ...SAFE_INPUT,
      selfCheckFallback: true,
      factConsistencyScore: 1,
    });
    expect(result.blockers).toContainEqual({ kind: "self_check_fallback" });
  });

  it("blocks an RSS-only Story when its fact check fails", () => {
    const result = assessPublicationReadiness({
      ...SAFE_INPUT,
      fullArticleSourceCount: 0,
      factConsistencyScore: 0.94,
    });
    expect(result.blockers).toContainEqual({ kind: "fact_check_failed" });
  });

  it("blocks missing credibility and a missing source", () => {
    const result = assessPublicationReadiness({
      ...SAFE_INPUT,
      credibilityScore: null,
      sourceCount: 0,
      fullArticleSourceCount: 0,
    });
    expect(result.blockers).toEqual(
      expect.arrayContaining([{ kind: "missing_credibility" }, { kind: "missing_source" }]),
    );
  });

  it("allows an RSS-only Story when every content and safety check passes", () => {
    const result = assessPublicationReadiness({
      ...SAFE_INPUT,
      sourceCount: 1,
      fullArticleSourceCount: 0,
    });
    expect(result).toMatchObject({ passed: true, blockers: [] });
  });

  it("blocks the real production Rodri mistranslation on a fresh assessment", () => {
    const result = assessPublicationReadiness({
      ...SAFE_INPUT,
      titleHu: "Hogyan kezeli a Manchester City a Rodri-kérdést?",
      leadHu:
        "A BBC Sport vizsgálja, hogyan alakulhat a Manchester City új középpályája, és időtlen-e a Rodri eladása.",
    });
    expect(result.blockers).toContainEqual({
      kind: "content_quality_failed",
      qualityIssue: { field: "lead", kind: "forbidden_terminology" },
    });
  });

  it("blocks the real production repeated fallback Story", () => {
    const sentence =
      "Bukayo Saka mesterhármast szerzett, Anglia pedig 6-4-re legyőzte Franciaországot.";
    const result = assessPublicationReadiness({
      ...SAFE_INPUT,
      isAiGenerated: false,
      bodyHu: `${sentence} Az angol csapat bronzérmes lett. ${sentence}`,
    });
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        { kind: "fallback_generation" },
        {
          kind: "content_quality_failed",
          qualityIssue: { field: "body", kind: "repeated_sentence" },
        },
      ]),
    );
  });

  it("blocks short placeholder content", () => {
    const result = assessPublicationReadiness({
      ...SAFE_INPUT,
      titleHu: "Hír",
      leadHu: "Rövid lead.",
      bodyHu: "Rövid törzs.",
    });
    expect(result.qualityIssues).toEqual(
      expect.arrayContaining([
        { field: "title", kind: "too_short" },
        { field: "lead", kind: "too_short" },
        { field: "body", kind: "too_short" },
      ]),
    );
  });
});
