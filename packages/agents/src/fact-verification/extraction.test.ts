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
            claim_en: "Liverpool won 3-1.",
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
        claimEn: "Liverpool won 3-1.",
        evidenceOriginal: "Liverpool win 3-1",
        subject: "",
        predicate: "",
        normalizedValue: null,
        eventTimeIso: null,
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

  it("anchors relative dates to the source publication timestamp, not processing time", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "event_time",
            claim_en: "The deadline is tomorrow.",
            evidence_original: "before tomorrow's deadline",
            subject: "transfer deadline",
            predicate: "event_time",
            normalized_value: null,
            event_time_iso: "2026-08-31T00:00:00.000Z",
            quote_original: null,
            quote_speaker: null,
          },
        ],
      },
      inputTokens: 10,
      outputTokens: 10,
    });

    await extractFacts(llm, {
      titleOriginal: "Transfer update",
      bodyOriginal: "Carrick discussed options before tomorrow's deadline.",
      publishedAtSource: new Date("2026-08-30T19:49:00.000Z"),
      processingTimestamp: new Date("2026-09-02T08:00:00.000Z"),
    });

    const prompt = llm.jsonRequests[0]?.messages[0]?.content ?? "";
    expect(prompt).toContain("source_published_at: 2026-08-30T19:49:00.000Z");
    expect(prompt).toContain("processing_timestamp: 2026-09-02T08:00:00.000Z");
  });

  it("rejects an August 15 event time for a tomorrow deadline published on August 30", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "event_time",
            claim_en: "The deadline is tomorrow.",
            evidence_original: "before tomorrow's deadline",
            subject: "transfer deadline",
            predicate: "event_time",
            normalized_value: null,
            event_time_iso: "2026-08-15T00:00:00.000Z",
            quote_original: null,
            quote_speaker: null,
          },
        ],
      },
      inputTokens: 10,
      outputTokens: 10,
    });

    await expect(
      extractFacts(llm, {
        titleOriginal: "Transfer update",
        bodyOriginal: "Carrick discussed options before tomorrow's deadline.",
        publishedAtSource: new Date("2026-08-30T19:49:00.000Z"),
      }),
    ).rejects.toThrow("0 grounded facts");
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
            claim_en: "The article contains one general statement.",
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
          claim_en: `Grounded fact ${index + 1}.`,
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
            claim_en: "The match finished 1-1.",
            evidence_original: "The match finished 1-1",
            quote_original: null,
            quote_speaker: null,
          },
          {
            fact_type: "other",
            claim_en: "Leeds came back from 2-0 down.",
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
    expect(facts[0]?.claimEn).toContain("1-1");
    expect(llm.jsonRequests).toHaveLength(1);
  });

  it("matches evidence after case, whitespace and Unicode quote normalization", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "quote",
            claim_en: "Farke said they earned a difficult point.",
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
            claim_en: "Andrews said Daniel must not be underestimated.",
            evidence_original: "Never underestimate Daniel",
            quote_original: null,
            quote_speaker: null,
          },
          {
            fact_type: "other",
            claim_en: "Daniel cannot be underestimated, according to Andrews.",
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
            claim_en: `Grounded fact ${index + 1}.`,
            evidence_original: item,
            quote_original: null,
            quote_speaker: null,
          })),
          {
            fact_type: "other",
            claim_en: "Unsupported sixth fact.",
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
