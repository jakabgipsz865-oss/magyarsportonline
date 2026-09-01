import { CloudflareWorkersAiLlmClient, FakeLlmClient, MODEL_TIERS } from "@magyarsportonline/llm";
import { describe, expect, it, vi } from "vitest";
import { extractFacts } from "./extraction";

describe("extractFacts", () => {
  it("grounds facts returned through Cloudflare native JSON Mode", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: {
              response: {
                facts: [
                  {
                    fact_type: "transfer_status",
                    claim_en: "Manchester United submitted a £60m bid.",
                    evidence_original: "Manchester United submitted a £60m bid",
                    subject: "Manchester United",
                    predicate: "transfer_bid",
                    normalized_value: "£60m",
                    event_time_iso: null,
                    quote_original: null,
                    quote_speaker: null,
                  },
                ],
              },
              usage: { prompt_tokens: 20, completion_tokens: 10 },
            },
            success: true,
            errors: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const llm = new CloudflareWorkersAiLlmClient({
      accountId: "acc",
      apiToken: "token",
      fetchImpl,
    });

    const facts = await extractFacts(llm, {
      titleOriginal: "Manchester United transfer update",
      bodyOriginal: "Manchester United submitted a £60m bid for the midfielder.",
    });

    expect(facts).toEqual([
      expect.objectContaining({
        claimEn: "Manchester United submitted a £60m bid.",
        evidenceOriginal: "Manchester United submitted a £60m bid",
      }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a malformed native JSON Mode response exactly once", async () => {
    const valid = {
      result: {
        response: {
          facts: [
            {
              fact_type: "other",
              claim_en: "Carrick signed a three-year contract.",
              evidence_original: "Carrick signed a three-year contract",
              subject: "Carrick",
              predicate: "contract",
              normalized_value: "three years",
              event_time_iso: null,
              quote_original: null,
              quote_speaker: null,
            },
          ],
        },
      },
      success: true,
      errors: [],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { response: "{malformed" }, errors: [] })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(valid)));
    const llm = new CloudflareWorkersAiLlmClient({
      accountId: "acc",
      apiToken: "token",
      fetchImpl,
    });

    await expect(
      extractFacts(llm, {
        titleOriginal: "Carrick contract",
        bodyOriginal: "Carrick signed a three-year contract at Old Trafford.",
      }),
    ).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

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
    expect(request?.system).toContain("Nincs minimum vagy cél Fact-darabszám");
    expect(request?.system).not.toMatch(/10-14|legalább 6/u);
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
    ).rejects.toThrow("no grounded facts");
  });

  it("fails closed to an unknown event time instead of rejecting the full structured response", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        facts: [
          {
            fact_type: "event_time",
            claim_en: "The meeting will happen before the deadline.",
            evidence_original: "before the deadline",
            subject: "meeting",
            predicate: "event_time",
            normalized_value: null,
            event_time_iso: "2026-09-01",
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
        titleOriginal: "Meeting update",
        bodyOriginal: "The parties will meet before the deadline.",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        claimEn: "The meeting will happen before the deadline.",
        eventTimeIso: null,
      }),
    ]);
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

  it("accepts one grounded fact from a long source without a count-driven retry", async () => {
    const llm = new FakeLlmClient();
    const response = {
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
    };
    llm.queueJson(response);

    await expect(
      extractFacts(llm, { titleOriginal: "Full article", bodyOriginal: "A".repeat(2_500) }),
    ).resolves.toHaveLength(1);
    expect(llm.jsonRequests).toHaveLength(1);
  });

  it("fails closed on zero grounded facts without a count-driven retry", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { facts: [] },
      inputTokens: 100,
      outputTokens: 10,
    });

    await expect(
      extractFacts(llm, {
        titleOriginal: "Full article",
        bodyOriginal: "A".repeat(2_500),
      }),
    ).rejects.toThrow("no grounded facts");
    expect(llm.jsonRequests).toHaveLength(1);
  });

  it("retries malformed Cloudflare JSON once without exceeding two attempts", async () => {
    const llm = new FakeLlmClient();
    const evidence = Array.from({ length: 6 }, (_, index) => `Evidence ${index + 1}`);
    vi.spyOn(llm, "completeJson")
      .mockRejectedValueOnce(new Error("Cloudflare Workers AI returned non-JSON output"))
      .mockResolvedValueOnce({
        data: {
          facts: evidence.map((item, index) => ({
            fact_type: "other",
            claim_en: `Grounded fact ${index + 1}.`,
            evidence_original: item,
            quote_original: null,
            quote_speaker: null,
          })),
        },
        inputTokens: 100,
        outputTokens: 80,
      });

    await expect(
      extractFacts(llm, {
        titleOriginal: "Full article",
        bodyOriginal: `${evidence.join(". ")}. `.repeat(30),
      }),
    ).resolves.toHaveLength(6);
    expect(llm.completeJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(llm.completeJson).mock.calls[1]?.[0].system).toContain(
      "TECHNIKAI ÚJRAPRÓBÁLÁS",
    );
  });

  it("keeps six verbatim grounded facts from an Express-like long-source retry", async () => {
    const llm = new FakeLlmClient();
    const bodyOriginal = `${[
      "Manchester United submitted a £60m bid for the midfielder.",
      "The selling club rejected the offer on Sunday.",
      "Michael Carrick signed a three-year contract at Old Trafford.",
      "The forward scored 12 goals in 34 league appearances last season.",
      "His medical is scheduled for Monday at Carrington.",
      "The transfer deadline is Tuesday at 7pm.",
      "Club officials remain in talks and no final agreement has been announced.",
    ].join(
      " ",
    )} ${"The report describes the talks, the player's record and the club's timetable. ".repeat(18)}`;
    vi.spyOn(llm, "completeJson")
      .mockRejectedValueOnce(new Error("Cloudflare Workers AI returned non-JSON output"))
      .mockResolvedValueOnce({
        data: {
          facts: [
            {
              fact_type: "transfer_status",
              claim_en: "Manchester United submitted a £60m bid.",
              evidence_original: "Manchester United submitted a £60m bid",
              quote_original: null,
              quote_speaker: null,
            },
            {
              fact_type: "transfer_status",
              claim_en: "The selling club rejected the offer.",
              evidence_original: "selling club rejected the offer on Sunday",
              quote_original: null,
              quote_speaker: null,
            },
            {
              fact_type: "other",
              claim_en: "Michael Carrick signed a three-year contract.",
              evidence_original: "Michael Carrick signed a three-year contract",
              quote_original: null,
              quote_speaker: null,
            },
            {
              fact_type: "other",
              claim_en: "The forward scored 12 goals in 34 league appearances.",
              evidence_original: "forward scored 12 goals in 34 league appearances",
              quote_original: null,
              quote_speaker: null,
            },
            {
              fact_type: "event_time",
              claim_en: "The medical is scheduled for Monday.",
              evidence_original: "medical is scheduled for Monday at Carrington",
              event_time_iso: "2026-08-31T09:00:00.000Z",
              quote_original: null,
              quote_speaker: null,
            },
            {
              fact_type: "event_time",
              claim_en: "The transfer deadline is Tuesday at 7pm.",
              evidence_original: "transfer deadline is Tuesday at 7pm",
              event_time_iso: "2026-09-01T19:00:00.000Z",
              quote_original: null,
              quote_speaker: null,
            },
            {
              fact_type: "transfer_status",
              claim_en: "A £75m agreement was completed.",
              evidence_original: "A £75m agreement was completed",
              quote_original: null,
              quote_speaker: null,
            },
          ],
        },
        inputTokens: 500,
        outputTokens: 300,
      });

    const facts = await extractFacts(llm, {
      titleOriginal: "Manchester United transfer update",
      bodyOriginal,
      publishedAtSource: new Date("2026-08-30T12:00:00.000Z"),
    });

    expect(facts).toHaveLength(6);
    expect(facts.every((fact) => fact.claimEn && fact.evidenceOriginal)).toBe(true);
    expect(
      facts.every((fact) =>
        bodyOriginal.toLowerCase().includes(fact.evidenceOriginal.toLowerCase()),
      ),
    ).toBe(true);
    expect(facts.some((fact) => fact.claimEn.includes("£75m"))).toBe(false);
    expect(llm.completeJson).toHaveBeenCalledTimes(2);
    const requests = vi.mocked(llm.completeJson).mock.calls.map(([request]) => request);
    expect(requests[0]?.system).not.toContain("TECHNIKAI ÚJRAPRÓBÁLÁS");
    expect(requests[0]?.system).not.toMatch(/10-14|legalább 6/u);
    expect(requests[1]?.system).toContain("TECHNIKAI ÚJRAPRÓBÁLÁS");
    expect(requests[1]?.system).not.toMatch(/10-14|legalább 6/u);
    expect(requests[1]?.maxTokens).toBe(3072);
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

  it("keeps five grounded facts after rejecting an unsupported sixth", async () => {
    const llm = new FakeLlmClient();
    const evidence = Array.from({ length: 5 }, (_, index) => `Supported evidence ${index + 1}`);
    const response = {
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
    };
    llm.queueJson(response);

    await expect(
      extractFacts(llm, {
        titleOriginal: "Full article",
        bodyOriginal: `${evidence.join(". ")}. `.repeat(40),
      }),
    ).resolves.toHaveLength(5);
    expect(llm.jsonRequests).toHaveLength(1);
  });
});
