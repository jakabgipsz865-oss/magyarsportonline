import { FakeLlmClient, MODEL_TIERS } from "@magyarsportonline/llm";
import { describe, expect, it } from "vitest";
import { rewriteForStyle } from "./rewrite";

describe("rewriteForStyle", () => {
  it("uses the editorial rewrite model and returns the parsed content", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: {
        rewritten_title_hu: "Bombagóllal nyert a Liverpool",
        rewritten_lead_hu: "A csapat magabiztosan győzött hazai pályán.",
        rewritten_body_hu: "Részletek a mérkőzésről.",
      },
      inputTokens: 50,
      outputTokens: 40,
    });

    const result = await rewriteForStyle(llm, {
      facts: [{ factType: "score", detailHu: "3-1", quoteOriginal: null, quoteSpeaker: null }],
      titleHu: "Liverpool nyert 3-1-re",
      leadHu: "A csapat nyert.",
      bodyHu: "Részletek.",
    });

    expect(result).toEqual({
      titleHu: "Bombagóllal nyert a Liverpool",
      leadHu: "A csapat magabiztosan győzött hazai pályán.",
      bodyHu: "Részletek a mérkőzésről.",
      isFallback: false,
    });
    expect(llm.jsonRequests[0]?.model).toBe(MODEL_TIERS.editorialRewrite);
  });

  it("sends the current title/lead/body and facts in the request", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { rewritten_title_hu: "T", rewritten_lead_hu: "L", rewritten_body_hu: "B" },
      inputTokens: 0,
      outputTokens: 0,
    });

    await rewriteForStyle(llm, {
      facts: [],
      titleHu: "Eredeti cím",
      leadHu: "Eredeti lead",
      bodyHu: "Eredeti törzs",
    });

    const content = llm.jsonRequests[0]?.messages[0]?.content ?? "";
    expect(content).toContain("Eredeti cím");
    expect(content).toContain("Eredeti lead");
    expect(content).toContain("Eredeti törzs");
  });

  it("propagates isFallback when the LLM client served this call from a fallback", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { rewritten_title_hu: "T", rewritten_lead_hu: "L", rewritten_body_hu: "B" },
      inputTokens: 0,
      outputTokens: 0,
      isFallback: true,
    });

    const result = await rewriteForStyle(llm, {
      facts: [],
      titleHu: "T",
      leadHu: "L",
      bodyHu: "B",
    });

    expect(result.isFallback).toBe(true);
  });

  it("adds a lexicon glossary block when a known term appears in a quote", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { rewritten_title_hu: "T", rewritten_lead_hu: "L", rewritten_body_hu: "B" },
      inputTokens: 0,
      outputTokens: 0,
    });

    await rewriteForStyle(llm, {
      facts: [
        {
          factType: "quote",
          detailHu: "",
          quoteOriginal: "The goalkeeper kept a clean sheet tonight.",
          quoteSpeaker: "Manager",
        },
      ],
      titleHu: "T",
      leadHu: "L",
      bodyHu: "B",
    });

    expect(llm.jsonRequests[0]?.system).toContain("clean sheet");
    expect(llm.jsonRequests[0]?.system).toContain("→");
  });

  it("also matches known terms left untranslated in the current Hungarian draft", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { rewritten_title_hu: "T", rewritten_lead_hu: "L", rewritten_body_hu: "B" },
      inputTokens: 0,
      outputTokens: 0,
    });

    await rewriteForStyle(llm, {
      facts: [],
      titleHu: "T",
      leadHu: "L",
      bodyHu: "A csapat clean sheet-tel zárta a mérkőzést.",
    });

    expect(llm.jsonRequests[0]?.system).toContain("clean sheet");
  });

  it("omits the lexicon block when nothing matches", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { rewritten_title_hu: "T", rewritten_lead_hu: "L", rewritten_body_hu: "B" },
      inputTokens: 0,
      outputTokens: 0,
    });

    await rewriteForStyle(llm, { facts: [], titleHu: "T", leadHu: "L", bodyHu: "B" });

    expect(llm.jsonRequests[0]?.system).not.toContain("→");
  });
});
