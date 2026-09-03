import {
  EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
  type EditorialKnowledgeRecord,
} from "@magyarsportonline/db";
import { FakeLlmClient, MODEL_TIERS } from "@magyarsportonline/llm";
import { describe, expect, it } from "vitest";
import {
  generateStoryVersion,
  regenerateWithFactRepair,
  regenerateWithQualityFix,
} from "./generation";

function generationData(input?: {
  title?: string;
  lead?: string;
  body?: string;
  changeSummary?: string | null;
}) {
  return {
    title: { text: input?.title ?? "T", supporting_fact_ids: ["fact-1"] },
    lead_sentences: [{ id: "L1", text: input?.lead ?? "L", supporting_fact_ids: ["fact-1"] }],
    body_sentences: [{ id: "B1", text: input?.body ?? "B", supporting_fact_ids: ["fact-1"] }],
    change_summary_hu: input?.changeSummary ?? null,
  };
}

describe("generateStoryVersion", () => {
  it("uses the writing model and returns the parsed content", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: generationData({
        title: "Liverpool nagy győzelmet aratott",
        lead: "A csapat magabiztosan nyert.",
        body: "Részletek a mérkőzésről.",
      }),
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
      sentenceProvenance: [
        {
          sentenceId: "T1",
          section: "title",
          text: "Liverpool nagy győzelmet aratott",
          supportingFactIds: ["fact-1"],
        },
        {
          sentenceId: "L1",
          section: "lead",
          text: "A csapat magabiztosan nyert.",
          supportingFactIds: ["fact-1"],
        },
        {
          sentenceId: "B1",
          section: "body",
          text: "Részletek a mérkőzésről.",
          supportingFactIds: ["fact-1"],
        },
      ],
      isFallback: false,
    });
    expect(llm.jsonRequests[0]?.model).toBe(MODEL_TIERS.writing);
    expect(llm.jsonRequests[0]?.maxTokens).toBe(3072);
    expect(llm.jsonRequests[0]?.thinkingLevel).toBe("minimal");
    expect(llm.jsonRequests[0]?.system).toContain("6-14 szavas");
    expect(llm.jsonRequests[0]?.system).toContain("ne szenzációhajhász");
  });

  it("propagates isFallback when the LLM client served this call from a fallback", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: generationData(),
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
      data: generationData({ changeSummary: "Frissült az eredmény." }),
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

  it("adds only the supplied V2 knowledge to the system prompt", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: generationData(),
      inputTokens: 1,
      outputTokens: 1,
    });

    await generateStoryVersion(llm, {
      facts: [],
      previousVersion: null,
      knowledge: [KNOWLEDGE],
    });

    const system = llm.jsonRequests[0]?.system ?? "";
    expect(system).toContain("SZERKESZTŐI TUDÁS V2:");
    expect(system).toContain("held to a draw");
    expect(system).toContain("döntetlenre kényszerítették");
    expect(system).toContain("döntetlenhez tartották");
  });

  it("keeps an empty V2 knowledge store out of the generated prompt", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: generationData(),
      inputTokens: 1,
      outputTokens: 1,
    });

    await generateStoryVersion(llm, { facts: [], previousVersion: null });

    const system = llm.jsonRequests[0]?.system ?? "";
    expect(system).not.toContain("\n\nSZERKESZTŐI TUDÁS V2:\n-");
  });

  it("passes the previous draft and self-check issues to the fact-repair prompt", async () => {
    const llm = new FakeLlmClient();
    llm.queueJson({
      data: generationData({ title: "Javított", lead: "Javított lead", body: "Javított törzs" }),
      inputTokens: 1,
      outputTokens: 1,
    });

    await regenerateWithFactRepair(llm, {
      facts: [{ factType: "score", detailHu: "3-1", quoteOriginal: null, quoteSpeaker: null }],
      previousVersion: null,
      previousAttempt: { titleHu: "Hibás", leadHu: "Hibás lead", bodyHu: "Hibás törzs" },
      selfCheckIssues: ["A 4-1-es eredmény nincs a Facts között"],
    });

    expect(llm.jsonRequests[0]?.messages[0]?.content).toContain(
      "A 4-1-es eredmény nincs a Facts között",
    );
    expect(llm.jsonRequests[0]?.system).toContain("Facts az egyetlen hiteles tartalmi forrás");
    expect(llm.jsonRequests[0]?.system).toContain(
      "Nincs minimális karakter-, mondat- vagy bekezdésszám",
    );
    expect(llm.jsonRequests[0]?.system).not.toContain("800 karakter");
    expect(llm.jsonRequests[0]?.system).not.toContain("4–7");
  });

  it("uses the same no-padding contract for generation, fact repair and quality fix", async () => {
    const llm = new FakeLlmClient();
    const response = {
      data: generationData({ title: "Rövid cím", lead: "Rövid lead", body: "Rövid törzs" }),
      inputTokens: 1,
      outputTokens: 1,
    };
    llm.queueJson(response);
    llm.queueJson(response);
    llm.queueJson(response);
    const facts = Array.from({ length: 10 }, () => ({
      factType: "transfer_status",
      detailHu: "A klub tárgyal a játékossal.",
      quoteOriginal: null,
      quoteSpeaker: null,
    }));

    await generateStoryVersion(llm, { facts, previousVersion: null });
    await regenerateWithFactRepair(llm, {
      facts,
      previousVersion: null,
      previousAttempt: { titleHu: "Cím", leadHu: "Lead", bodyHu: "Törzs" },
      selfCheckIssues: ["unsupported context"],
    });
    await regenerateWithQualityFix(llm, {
      facts,
      previousVersion: null,
      previousAttempt: { titleHu: "Cím", leadHu: "Lead", bodyHu: "Törzs" },
      issues: [{ field: "body", kind: "repeated_sentence" }],
    });

    for (const request of llm.jsonRequests) {
      expect(request.system).toContain("Nincs minimális karakter-, mondat- vagy bekezdésszám");
      expect(request.system).toContain("csak explicit Fact/evidence alapján");
      expect(request.system).toContain("Semmilyen „köztudott” háttér-információt ne használj");
      expect(request.system).not.toContain("800 karakter");
      expect(request.system).not.toContain("4–7");
    }
  });
});

const KNOWLEDGE: EditorialKnowledgeRecord = {
  schema_version: EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
  stable_key: "football.mwe.held-to-a-draw",
  revision: 1,
  knowledge_type: "multi_word_expression",
  language: { source: "en", target: "hu" },
  sport: "football",
  contexts: ["match_report"],
  source_phrase: "held to a draw",
  canonical_hu: "döntetlenre kényszerítették",
  alternative_hu: [],
  avoid_hu: ["döntetlenhez tartották"],
  instruction_hu: null,
  match_terms: ["held to a draw"],
  confidence: 1,
  status: "active",
  provenance: { source: "test fixture", source_url: null, license: "editorial-original" },
  editorial_note: null,
  positive_examples: [],
  negative_examples: [],
  replaced_by: null,
};
