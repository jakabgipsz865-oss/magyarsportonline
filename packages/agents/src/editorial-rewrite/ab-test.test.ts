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
  it("returns pipeline B, a judge verdict and aggregated token usage when the rewrite is accepted", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1); // aIsFirst = true -> "1" maps to A
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        rewritten_title_hu: "Bombagóllal nyert a Liverpool",
        rewritten_lead_hu: "Stilizált lead.",
        rewritten_body_hu: "Stilizált törzs.",
      },
      inputTokens: 10,
      outputTokens: 5,
    });
    llm.queueJson({
      data: { consistent: true, fact_consistency_score: 0.95, issues: [] },
      inputTokens: 8,
      outputTokens: 3,
    });
    llm.queueJson({
      data: { winner: "2", score_1: 6, score_2: 9, rationale_hu: "Verzió 2 olvasmányosabb." },
      inputTokens: 20,
      outputTokens: 4,
    });

    const result = await runAbComparison(llm, baseInput());

    expect(result.pipelineB.rewriteAccepted).toBe(true);
    expect(result.pipelineB.rejectionKind).toBeNull();
    expect(result.pipelineB.titleHu).toBe("Bombagóllal nyert a Liverpool");
    expect(result.pipelineA.titleHu).toBe("Liverpool nyert 3-1-re");
    expect(result.judge).toEqual({
      winner: "B",
      scoreA: 6,
      scoreB: 9,
      rationaleHu: "Verzió 2 olvasmányosabb.",
    });
    expect(result.llmUsage).toEqual({ inputTokens: 38, outputTokens: 12, calls: 3 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.pipelineA.quality.issues)).toBe(true);
    expect(Array.isArray(result.pipelineB.quality.issues)).toBe(true);
  });

  it("keeps pipeline A, skips the judge and reports a fact_check_failed rejection", async () => {
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
    expect(result.pipelineB.rejectionKind).toBe("fact_check_failed");
    expect(result.pipelineB.rejectionReason).toEqual(["hallucinated fact"]);
    expect(result.pipelineB.titleHu).toBe(result.pipelineA.titleHu);
    expect(result.judge).toBeNull();
    expect(result.llmUsage.calls).toBe(2); // no judge call made
  });

  it("reports a fallback rejection when the rewrite call itself came from a fallback", async () => {
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
    expect(result.pipelineB.rejectionKind).toBe("fallback");
    expect(result.judge).toBeNull();
  });
});
