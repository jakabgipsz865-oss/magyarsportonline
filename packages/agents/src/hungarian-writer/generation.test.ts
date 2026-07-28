import { FakeLlmClient, MODEL_TIERS } from "@magyarsportonline/llm";
import { describe, expect, it } from "vitest";
import { generateStoryVersion } from "./generation";

describe("generateStoryVersion", () => {
  it("uses the writing model and returns the parsed content", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        title_hu: "Liverpool nagy győzelmet aratott",
        lead_hu: "A csapat magabiztosan nyert.",
        body_hu: "Részletek a mérkőzésről.",
        change_summary_hu: null,
      },
      inputTokens: 50,
      outputTokens: 40,
    });

    const result = await generateStoryVersion(llm, {
      facts: [{ factType: "score", detailHu: "3-1", quoteOriginal: null, quoteSpeaker: null }],
      previousVersion: null,
    });

    expect(result).toEqual({
      titleHu: "Liverpool nagy győzelmet aratott",
      leadHu: "A csapat magabiztosan nyert.",
      bodyHu: "Részletek a mérkőzésről.",
      changeSummaryHu: null,
      isFallback: false,
    });
    expect(llm.jsonRequests[0]?.model).toBe(MODEL_TIERS.writing);
  });

  it("propagates isFallback when the LLM client served this call from a fallback", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { title_hu: "T", lead_hu: "L", body_hu: "B", change_summary_hu: null },
      inputTokens: 0,
      outputTokens: 0,
      isFallback: true,
    });

    const result = await generateStoryVersion(llm, { facts: [], previousVersion: null });

    expect(result.isFallback).toBe(true);
  });

  it("includes the previous version in the request when updating", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        title_hu: "T",
        lead_hu: "L",
        body_hu: "B",
        change_summary_hu: "Frissült az eredmény.",
      },
      inputTokens: 1,
      outputTokens: 1,
    });

    await generateStoryVersion(llm, {
      facts: [],
      previousVersion: { titleHu: "Old title", leadHu: "Old lead", bodyHu: "Old body" },
    });

    const content = llm.jsonRequests[0]?.messages[0]?.content ?? "";
    expect(content).toContain("Old title");
  });

  it("adds a lexicon glossary block to the system prompt when a quote contains a known football term", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { title_hu: "T", lead_hu: "L", body_hu: "B", change_summary_hu: null },
      inputTokens: 1,
      outputTokens: 1,
    });

    await generateStoryVersion(llm, {
      facts: [
        {
          factType: "quote",
          detailHu: "",
          quoteOriginal: "The goalkeeper kept a clean sheet tonight.",
          quoteSpeaker: "Manager",
        },
      ],
      previousVersion: null,
    });

    expect(llm.jsonRequests[0]?.system).toContain("clean sheet");
    expect(llm.jsonRequests[0]?.system).toContain("→");
  });

  it("omits the lexicon block when no quote contains a known term", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { title_hu: "T", lead_hu: "L", body_hu: "B", change_summary_hu: null },
      inputTokens: 1,
      outputTokens: 1,
    });

    await generateStoryVersion(llm, {
      facts: [{ factType: "score", detailHu: "3-1", quoteOriginal: null, quoteSpeaker: null }],
      previousVersion: null,
    });

    expect(llm.jsonRequests[0]?.system).not.toContain("→");
  });
});
