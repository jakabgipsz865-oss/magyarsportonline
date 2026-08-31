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
            evidence_original: "Liverpool win 3-1",
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

  it("rejects a severely under-extracted full article so the durable job can retry", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "other",
            detail_hu: "A cikk egyetlen általános állítást tartalmaz.",
            evidence_original: "AAAA",
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
    ).rejects.toThrow("expected at least 6");
  });

  it("accepts six distinct facts for a full article without an expensive retry", async () => {
    const llm = new FakeLlmClient();
    const evidence = Array.from({ length: 6 }, (_, index) => `Evidence ${index + 1}`);
    llm.queueJson({
      data: {
        facts: Array.from({ length: 6 }, (_, index) => ({
          fact_type: "other",
          detail_hu: `Ellenőrzött tény ${index + 1}.`,
          evidence_original: evidence[index],
          quote_original: null,
          quote_speaker: null,
        })),
      },
      inputTokens: 100,
      outputTokens: 80,
    });

    const facts = await extractFacts(llm, {
      titleOriginal: "Full article",
      bodyOriginal: `${evidence.join(". ")}. `.repeat(30),
    });

    expect(facts).toHaveLength(6);
  });

  it("drops an unsupported fact whose evidence is absent without another LLM call", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "score",
            detail_hu: "A mérkőzés 1-1-re végződött.",
            evidence_original: "The match finished 1-1",
            quote_original: null,
            quote_speaker: null,
          },
          {
            fact_type: "other",
            detail_hu: "A Leeds 2-0-s hátrányból állt fel.",
            evidence_original: "Leeds came back from 2-0 down",
            quote_original: null,
            quote_speaker: null,
          },
        ],
      },
      inputTokens: 100,
      outputTokens: 40,
    });

    const facts = await extractFacts(llm, {
      titleOriginal: "Leeds draw with Brentford",
      bodyOriginal: "The match finished 1-1 after a late equaliser.",
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]?.detailHu).toContain("1-1");
    expect(llm.jsonRequests).toHaveLength(1);
  });

  it("matches evidence after case, whitespace and Unicode quote normalization", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "quote",
            detail_hu: "Farke szerint nehéz pontot szereztek.",
            evidence_original: "‘A HARD   but precious point’",
            quote_original: "A hard but precious point",
            quote_speaker: "Daniel Farke",
          },
        ],
      },
      inputTokens: 100,
      outputTokens: 20,
    });

    await expect(
      extractFacts(llm, {
        titleOriginal: "Farke reaction",
        bodyOriginal: "'A hard but precious point', said Daniel Farke.",
      }),
    ).resolves.toHaveLength(1);
  });

  it("deduplicates facts backed by the same evidence", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "other",
            detail_hu: "Andrews szerint nem szabad lebecsülni Danielt.",
            evidence_original: "Never underestimate Daniel",
            quote_original: null,
            quote_speaker: null,
          },
          {
            fact_type: "other",
            detail_hu: "Danielt nem lehet lebecsülni Andrews szerint.",
            evidence_original: "Never underestimate Daniel",
            quote_original: null,
            quote_speaker: null,
          },
        ],
      },
      inputTokens: 100,
      outputTokens: 40,
    });

    const facts = await extractFacts(llm, {
      titleOriginal: "Andrews praises Farke",
      bodyOriginal: "Never underestimate Daniel, Andrews said.",
    });

    expect(facts).toHaveLength(1);
  });

  it("applies the full-article minimum after grounding and deduplication", async () => {
    const llm = new FakeLlmClient();
    const evidence = Array.from({ length: 5 }, (_, index) => `Supported evidence ${index + 1}`);
    llm.queueJson({
      data: {
        facts: [
          ...evidence.map((item, index) => ({
            fact_type: "other",
            detail_hu: `Alátámasztott tény ${index + 1}.`,
            evidence_original: item,
            quote_original: null,
            quote_speaker: null,
          })),
          {
            fact_type: "other",
            detail_hu: "Nem alátámasztott hatodik tény.",
            evidence_original: "Missing sixth evidence",
            quote_original: null,
            quote_speaker: null,
          },
        ],
      },
      inputTokens: 100,
      outputTokens: 80,
    });

    await expect(
      extractFacts(llm, {
        titleOriginal: "Full article",
        bodyOriginal: `${evidence.join(". ")}. `.repeat(40),
      }),
    ).rejects.toThrow("5 grounded facts; expected at least 6");
  });
});
