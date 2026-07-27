import type { LlmClient, LlmCompletionResult } from "@magyarsportonline/llm";
import { describe, expect, it, vi } from "vitest";
import { extractFactsWithLlm } from "./llm-extractor.js";

function fakeClient(responseText: string, costUsd: number | null = 0.0001): LlmClient {
  const result: LlmCompletionResult = {
    text: responseText,
    model: "claude-haiku-4-5-20251001",
    inputTokens: 100,
    outputTokens: 20,
    costUsd,
  };
  return { complete: vi.fn(async () => result) };
}

describe("extractFactsWithLlm", () => {
  it("parses a well-formed JSON response into facts", async () => {
    const client = fakeClient(
      '{"facts": [{"factType": "score", "payload": {"home": 2, "away": 1}}]}',
    );
    const recordCost = vi.fn();

    const facts = await extractFactsWithLlm(client, "Duna FC 2-1 Tisza SE", recordCost);

    expect(facts).toEqual([{ factType: "score", payload: { home: 2, away: 1 } }]);
    expect(recordCost).toHaveBeenCalledWith(0.0001);
  });

  it("extracts the JSON object even if the model added surrounding prose", async () => {
    const client = fakeClient(
      'Itt az eredmeny:\n{"facts": [{"factType": "quote", "payload": {"text": "jo volt"}}]}\nKesz.',
    );
    const facts = await extractFactsWithLlm(client, "...", vi.fn());
    expect(facts).toEqual([{ factType: "quote", payload: { text: "jo volt" } }]);
  });

  it("returns null (not throw) on malformed JSON", async () => {
    const client = fakeClient("not json at all");
    const facts = await extractFactsWithLlm(client, "...", vi.fn());
    expect(facts).toBeNull();
  });

  it("returns null when the JSON doesn't match the expected schema", async () => {
    const client = fakeClient('{"facts": [{"factType": "not-a-real-type", "payload": {}}]}');
    const facts = await extractFactsWithLlm(client, "...", vi.fn());
    expect(facts).toBeNull();
  });

  it("returns an empty array when the model reports no facts", async () => {
    const client = fakeClient('{"facts": []}');
    const facts = await extractFactsWithLlm(client, "...", vi.fn());
    expect(facts).toEqual([]);
  });
});
