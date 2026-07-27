import type { LlmClient, LlmCompletionResult } from "@magyarsportonline/llm";
import { describe, expect, it, vi } from "vitest";
import { selfCheckWithLlm } from "./self-check.js";

function fakeClient(text: string): LlmClient {
  const result: LlmCompletionResult = {
    text,
    model: "claude-haiku-4-5-20251001",
    inputTokens: 50,
    outputTokens: 20,
    costUsd: 0.0001,
  };
  return { complete: vi.fn(async () => result) };
}

describe("selfCheckWithLlm", () => {
  it("parses a consistent verdict", async () => {
    const client = fakeClient('{"consistent": true, "issues": []}');
    const result = await selfCheckWithLlm(client, [], "szoveg", vi.fn());
    expect(result).toEqual({ consistent: true, issues: [] });
  });

  it("parses an inconsistent verdict with issues", async () => {
    const client = fakeClient(
      '{"consistent": false, "issues": ["A szoveg 3-1-et allit, de a tenyek 2-1-et mondanak."]}',
    );
    const result = await selfCheckWithLlm(client, [], "szoveg", vi.fn());
    expect(result?.consistent).toBe(false);
    expect(result?.issues).toHaveLength(1);
  });

  it("returns null on unparseable output", async () => {
    const client = fakeClient("hiba tortent");
    const result = await selfCheckWithLlm(client, [], "szoveg", vi.fn());
    expect(result).toBeNull();
  });
});
