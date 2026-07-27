import { describe, expect, it, vi } from "vitest";
import { isLlmConfigured } from "./client.js";

describe("isLlmConfigured", () => {
  it("is false for undefined", () => {
    expect(isLlmConfigured(undefined)).toBe(false);
  });

  it("is false for an empty string", () => {
    expect(isLlmConfigured("")).toBe(false);
  });

  it("is true for a non-empty key", () => {
    expect(isLlmConfigured("sk-ant-fake-key")).toBe(true);
  });
});

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn(async () => ({
          content: [{ type: "text", text: "mocked response" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        })),
      };
    },
  };
});

describe("createAnthropicClient", () => {
  it("maps the Anthropic response into an LlmCompletionResult", async () => {
    const { createAnthropicClient } = await import("./client.js");
    const client = createAnthropicClient("fake-key");

    const result = await client.complete({
      model: "claude-haiku-4-5-20251001",
      system: "system prompt",
      prompt: "user prompt",
    });

    expect(result.text).toBe("mocked response");
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.costUsd).toBeCloseTo((100 * 1 + 50 * 5) / 1_000_000, 9);
  });
});
