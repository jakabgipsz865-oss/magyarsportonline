import { FakeLlmClient, MODEL_TIERS } from "@magyarsportonline/llm";
import { describe, expect, it } from "vitest";
import { selfCheckContent } from "./self-check";

describe("selfCheckContent", () => {
  it("uses the self-check model and returns the parsed verdict", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { consistent: true, fact_consistency_score: 0.95, issues: [] },
      inputTokens: 10,
      outputTokens: 5,
    });

    const result = await selfCheckContent(llm, {
      facts: [{ factType: "score", detailHu: "3-1", quoteOriginal: null, quoteSpeaker: null }],
      titleHu: "T",
      leadHu: "L",
      bodyHu: "B",
    });

    expect(result).toEqual({
      consistent: true,
      factConsistencyScore: 0.95,
      issues: [],
      isFallback: false,
    });
    expect(llm.jsonRequests[0]?.model).toBe(MODEL_TIERS.selfCheck);
  });

  it("propagates isFallback when the LLM client served this call from a fallback", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { consistent: true, fact_consistency_score: 1, issues: [] },
      inputTokens: 0,
      outputTokens: 0,
      isFallback: true,
    });

    const result = await selfCheckContent(llm, {
      facts: [],
      titleHu: "T",
      leadHu: "L",
      bodyHu: "B",
    });

    expect(result.isFallback).toBe(true);
  });

  it("surfaces reported issues when inconsistent", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        consistent: false,
        fact_consistency_score: 0.4,
        issues: ["A cím nem szerepel a tények között."],
      },
      inputTokens: 10,
      outputTokens: 5,
    });

    const result = await selfCheckContent(llm, {
      facts: [],
      titleHu: "T",
      leadHu: "L",
      bodyHu: "B",
    });

    expect(result.consistent).toBe(false);
    expect(result.issues).toEqual(["A cím nem szerepel a tények között."]);
  });
});
