import type { LlmClient, LlmCompletionResult } from "@magyarsportonline/llm";
import { describe, expect, it, vi } from "vitest";
import { generateWithLlm } from "./llm-writer.js";

function fakeClient(text: string): LlmClient {
  const result: LlmCompletionResult = {
    text,
    model: "claude-sonnet-5",
    inputTokens: 200,
    outputTokens: 150,
    costUsd: 0.002,
  };
  return { complete: vi.fn(async () => result) };
}

describe("generateWithLlm", () => {
  it("parses a well-formed writer response", async () => {
    const client = fakeClient(
      '{"title": "Cim", "lead": "Bevezeto", "body": "Torzs.", "changeSummary": "Osszefoglalo."}',
    );
    const output = await generateWithLlm(client, [], false, vi.fn());
    expect(output).toEqual({
      titleHu: "Cim",
      leadHu: "Bevezeto",
      bodyHu: "Torzs.",
      changeSummaryHu: "Osszefoglalo.",
    });
  });

  it("returns null when a required field is missing", async () => {
    const client = fakeClient('{"title": "Cim", "lead": "Bevezeto"}');
    const output = await generateWithLlm(client, [], false, vi.fn());
    expect(output).toBeNull();
  });

  it("returns null on non-JSON output", async () => {
    const client = fakeClient("Sajnalom, nem tudok segiteni.");
    const output = await generateWithLlm(client, [], false, vi.fn());
    expect(output).toBeNull();
  });
});
