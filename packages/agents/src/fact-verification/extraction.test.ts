import { FakeLlmClient, MODEL_TIERS } from "@magyarsportonline/llm";
import { describe, expect, it } from "vitest";
import { extractFacts } from "./extraction";

describe("extractFacts", () => {
  it("sends the article wrapped in a <source_article> block using the extraction model", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "score",
            detail_hu: "Liverpool 3-1 arányban nyert.",
            quote_original: null,
            quote_speaker: null,
          },
        ],
      },
      inputTokens: 100,
      outputTokens: 20,
    });

    const facts = await extractFacts(llm, {
      titleOriginal: "Liverpool win 3-1",
      bodyOriginal: "A dominant display at Anfield.",
    });

    expect(facts).toEqual([
      {
        factType: "score",
        detailHu: "Liverpool 3-1 arányban nyert.",
        quoteOriginal: null,
        quoteSpeaker: null,
      },
    ]);
    expect(llm.jsonRequests).toHaveLength(1);
    const [request] = llm.jsonRequests;
    expect(request?.model).toBe(MODEL_TIERS.extraction);
    expect(request?.maxTokens).toBe(2048);
    expect(request?.messages[0]?.content).toContain("<source_article>");
    expect(request?.messages[0]?.content).toContain("Liverpool win 3-1");
  });

  it("throws when the LLM response doesn't match the expected schema", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { facts: [{ fact_type: "not-a-real-type" }] },
      inputTokens: 1,
      outputTokens: 1,
    });

    await expect(extractFacts(llm, { titleOriginal: "T", bodyOriginal: "B" })).rejects.toThrow();
  });

  it("rejects an under-extracted full article so the durable job can retry", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "other",
            detail_hu: "A cikk egyetlen általános állítást tartalmaz.",
            quote_original: null,
            quote_speaker: null,
          },
        ],
      },
      inputTokens: 100,
      outputTokens: 20,
    });

    await expect(
      extractFacts(llm, {
        titleOriginal: "Full article",
        bodyOriginal: "A".repeat(2_500),
      }),
    ).rejects.toThrow("expected at least 10");
  });
});
