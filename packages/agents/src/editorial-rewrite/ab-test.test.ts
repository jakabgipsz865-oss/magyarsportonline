import { FakeLlmClient } from "@magyarsportonline/llm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAbComparison } from "./ab-test";

function baseInput() {
  return {
    storyId: "story-1",
    facts: [{ factType: "score", detailHu: "3-1", quoteOriginal: null, quoteSpeaker: null }],
    titleHu: "Liverpool nyert 3-1-re",
    leadHu: "A csapat nyert.",
    bodyHu: "Részletek a mérkőzésről.",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runAbComparison", () => {
  it("returns pipeline B and a judge verdict when the rewrite is accepted", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1); // aIsFirst = true -> "1" maps to A
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        rewritten_title_hu: "Bombagóllal nyert a Liverpool",
        rewritten_lead_hu: "Stilizált lead.",
        rewritten_body_hu: "Stilizált törzs.",
      },
      inputTokens: 1,
      outputTokens: 1,
    });
    llm.queueJson({
      data: { consistent: true, fact_consistency_score: 0.95, issues: [] },
      inputTokens: 1,
      outputTokens: 1,
    });
    llm.queueJson({
      data: { winner: "2", score_1: 6, score_2: 9, rationale_hu: "Verzió 2 olvasmányosabb." },
      inputTokens: 1,
      outputTokens: 1,
    });

    const result = await runAbComparison(llm, baseInput());

    expect(result.pipelineB.rewriteAccepted).toBe(true);
    expect(result.pipelineB.titleHu).toBe("Bombagóllal nyert a Liverpool");
    expect(result.pipelineA.titleHu).toBe("Liverpool nyert 3-1-re");
    expect(result.judge).toEqual({
      winner: "B",
      scoreA: 6,
      scoreB: 9,
      rationaleHu: "Verzió 2 olvasmányosabb.",
    });
  });

  it("keeps pipeline A and skips the judge when the fact-check rejects the rewrite", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        rewritten_title_hu: "Kitalált cím",
        rewritten_lead_hu: "Kitalált lead.",
        rewritten_body_hu: "Kitalált törzs.",
      },
      inputTokens: 1,
      outputTokens: 1,
    });
    llm.queueJson({
      data: { consistent: false, fact_consistency_score: 0.1, issues: ["hallucinated fact"] },
      inputTokens: 1,
      outputTokens: 1,
    });

    const result = await runAbComparison(llm, baseInput());

    expect(result.pipelineB.rewriteAccepted).toBe(false);
    expect(result.pipelineB.rejectionReason).toEqual(["hallucinated fact"]);
    expect(result.pipelineB.titleHu).toBe(result.pipelineA.titleHu);
    expect(result.judge).toBeNull();
    expect(llm.jsonRequests).toHaveLength(2); // no judge call made
  });

  it("keeps pipeline A when the rewrite call itself came from a fallback", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        rewritten_title_hu: "Liverpool nyert 3-1-re",
        rewritten_lead_hu: "A csapat nyert.",
        rewritten_body_hu: "Részletek a mérkőzésről.",
      },
      inputTokens: 0,
      outputTokens: 0,
      isFallback: true,
    });
    llm.queueJson({
      data: { consistent: true, fact_consistency_score: 1, issues: [] },
      inputTokens: 0,
      outputTokens: 0,
    });

    const result = await runAbComparison(llm, baseInput());

    expect(result.pipelineB.rewriteAccepted).toBe(false);
    expect(result.judge).toBeNull();
  });
});
