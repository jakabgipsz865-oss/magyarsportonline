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

  it("adds a learned lexicon entry from a slang/terminology correction to the system prompt", async () => {
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
          quoteOriginal: "He is a real super-sub for this team.",
          quoteSpeaker: "Manager",
        },
      ],
      previousVersion: null,
      learnedCorrections: [
        {
          id: "correction-1",
          category: "terminology",
          termEn: "super-sub",
          originalSentenceEn: "He is a real super-sub for this team.",
          currentSentenceHu: "szuper csere",
          correctedSentenceHu: "ütőkártya a cserepadról",
          note: "bevált csereember, aki rendszeresen eldönti a meccseket",
        },
      ],
    });

    const system = llm.jsonRequests[0]?.system ?? "";
    expect(system).toContain("super-sub");
    expect(system).toContain("ütőkártya a cserepadról");
  });

  it("adds a recommended phrasing and prompt example block from learned corrections", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { title_hu: "T", lead_hu: "L", body_hu: "B", change_summary_hu: null },
      inputTokens: 1,
      outputTokens: 1,
    });

    await generateStoryVersion(llm, {
      facts: [],
      previousVersion: null,
      learnedCorrections: [
        {
          id: "correction-2",
          category: "style",
          termEn: null,
          originalSentenceEn: "The manager praised the team's effort.",
          currentSentenceHu: "A menedzser dicsérte a csapat erőfeszítését.",
          correctedSentenceHu: "A vezetőedző elismerően nyilatkozott a csapat teljesítményéről.",
          note: null,
        },
      ],
    });

    const system = llm.jsonRequests[0]?.system ?? "";
    expect(system).toContain("AJÁNLOTT MAGYAR SPORTÚJSÁGÍRÓI MEGFOGALMAZÁSOK");
    expect(system).toContain("PROMPT PÉLDATÁR");
    expect(system).toContain("A vezetőedző elismerően nyilatkozott a csapat teljesítményéről.");
  });

  it("omits learned guidance blocks when no corrections are given", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: { title_hu: "T", lead_hu: "L", body_hu: "B", change_summary_hu: null },
      inputTokens: 1,
      outputTokens: 1,
    });

    await generateStoryVersion(llm, { facts: [], previousVersion: null });

    // A SYSTEM_PROMPT egy instrukciós mondata mindig szó szerint tartalmazza
    // mindkét blokkcímet (lásd football-lexicon.test.ts hasonló mintáját a
    // "FUTBALLNYELVI SZÓTÁR"-ra) — ezért a tényleges, formázott blokk saját
    // jelölőit (a felsorolásjel utáni kötőjel + idézőjel párokat) ellenőrizzük.
    const system = llm.jsonRequests[0]?.system ?? "";
    expect(system).not.toContain("→");
    expect(system).not.toContain('" helyett: "');
  });
});
