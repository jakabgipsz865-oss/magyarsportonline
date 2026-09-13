import { describe, expect, it, vi } from "vitest";
import { DailyLlmRequestCapError } from "./daily-request-cap";
import type { LlmClient } from "./client";
import { ConditionalFallbackLlmClient } from "./conditional-fallback-client";

const request = {
  model: "logical-writer",
  system: "system",
  messages: [{ role: "user" as const, content: "content" }],
  maxTokens: 100,
  jsonSchema: { type: "object" },
};

function client(label: string, error?: Error): LlmClient {
  return {
    modelLabel: label,
    completeText: vi.fn(async () => {
      if (error) throw error;
      return { text: label, inputTokens: 1, outputTokens: 2 };
    }),
    completeJson: vi.fn(async () => {
      if (error) throw error;
      return { data: { label }, inputTokens: 1, outputTokens: 2 };
    }),
  };
}

describe("ConditionalFallbackLlmClient", () => {
  it("uses the secondary AI model only for classified quota failures", async () => {
    const quota = new DailyLlmRequestCapError("gemini", 20);
    const primary = client("gemini", quota);
    const fallback = client("cloudflare");
    const llm = new ConditionalFallbackLlmClient(primary, fallback, (error) => error === quota);

    await expect(llm.completeJson(request)).resolves.toMatchObject({
      data: { label: "cloudflare" },
      modelLabel: "cloudflare",
    });
    expect(fallback.completeJson).toHaveBeenCalledOnce();
  });

  it("does not hide non-quota failures", async () => {
    const failure = new Error("invalid output");
    const fallback = client("cloudflare");
    const llm = new ConditionalFallbackLlmClient(client("gemini", failure), fallback, () => false);

    await expect(llm.completeText(request)).rejects.toBe(failure);
    expect(fallback.completeText).not.toHaveBeenCalled();
  });
});
