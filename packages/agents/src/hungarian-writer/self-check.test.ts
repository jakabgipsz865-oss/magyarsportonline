import { FakeLlmClient, MODEL_TIERS } from "@magyarsportonline/llm";
import { describe, expect, it } from "vitest";
import { selfCheckContent } from "./self-check";

const INPUT = {
  facts: [
    {
      id: "fact-1",
      factType: "score",
      claimEn: "Liverpool won 3-1.",
      evidenceOriginal: "Liverpool won 3-1.",
      quoteOriginal: null,
      quoteSpeaker: null,
    },
  ],
  titleHu: "A Liverpool 3-1-re győzött",
  leadHu: "A csapat megnyerte a mérkőzést. Három gólt szerzett.",
  bodyHu: "Az ellenfél egy gólt szerzett. A Liverpool két góllal nyert.",
};

function verdicts(unsupportedId?: string) {
  return Array.from({ length: 5 }, (_, index) => {
    const sentenceId = `S${index + 1}`;
    const supported = sentenceId !== unsupportedId;
    return {
      sentence_id: sentenceId,
      supported,
      supporting_fact_ids: supported ? ["fact-1"] : [],
      issue: supported ? null : "Az állítást egyetlen Fact sem támasztja alá.",
    };
  });
}

describe("selfCheckContent", () => {
  it("computes 1.0 deterministically when all five sentences are supported", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({ data: { verdicts: verdicts() }, inputTokens: 10, outputTokens: 5 });

    const result = await selfCheckContent(llm, INPUT);

    expect(result.consistent).toBe(true);
    expect(result.factConsistencyScore).toBe(1);
    expect(result.issues).toEqual([]);
    expect(llm.jsonRequests[0]?.model).toBe(MODEL_TIERS.selfCheck);
    expect(llm.jsonRequests[0]?.maxTokens).toBe(512);
    expect(llm.jsonRequests[0]?.system).toContain("Ne adj összesített score-t");
  });

  it("computes 0.8 and exposes the unsupported sentence evidence audit", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({ data: { verdicts: verdicts("S4") }, inputTokens: 10, outputTokens: 5 });

    const result = await selfCheckContent(llm, INPUT);

    expect(result.consistent).toBe(false);
    expect(result.factConsistencyScore).toBe(0.8);
    expect(result.sentenceVerdicts[3]).toMatchObject({
      sentenceId: "S4",
      supported: false,
      supportingFactIds: [],
      issue: "Az állítást egyetlen Fact sem támasztja alá.",
    });
    expect(result.issues[0]).toContain("S4: Az állítást egyetlen Fact sem támasztja alá");
    expect(result.issues[0]).toContain("supporting_fact_ids:");
  });

  it("fails closed when a sentence verdict is missing", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({ data: { verdicts: verdicts().slice(0, 4) }, inputTokens: 10, outputTokens: 5 });

    const result = await selfCheckContent(llm, INPUT);

    expect(result.consistent).toBe(false);
    expect(result.factConsistencyScore).toBe(0.8);
    expect(result.sentenceVerdicts[4]).toMatchObject({
      sentenceId: "S5",
      supported: false,
      issue: "missing_or_invalid_sentence_verdict",
    });
  });

  it("fails closed when a supporting Fact ID is invalid", async () => {
    const llm = new FakeLlmClient();
    const response = verdicts();
    response[2]!.supporting_fact_ids = ["invented-fact"];
    llm.queueJson({ data: { verdicts: response }, inputTokens: 10, outputTokens: 5 });

    const result = await selfCheckContent(llm, INPUT);

    expect(result.consistent).toBe(false);
    expect(result.sentenceVerdicts[2]?.issue).toBe("missing_or_invalid_sentence_verdict");
  });

  it("propagates isFallback while keeping the verdict calculation fail-closed", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { verdicts: verdicts("S1") },
      inputTokens: 0,
      outputTokens: 0,
      isFallback: true,
    });

    const result = await selfCheckContent(llm, INPUT);

    expect(result.isFallback).toBe(true);
    expect(result.consistent).toBe(false);
  });
});
