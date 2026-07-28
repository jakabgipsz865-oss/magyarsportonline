import { describe, expect, it } from "vitest";
import type { LlmClient } from "./client";
import { ProviderFallbackLlmClient, type LlmUsageSink } from "./provider-fallback-client";

function makeClient(label: string, opts?: { modelLabel?: string; fails?: boolean }): LlmClient {
  return {
    modelLabel: opts?.modelLabel,
    completeText: () => {
      if (opts?.fails) {
        return Promise.reject(new Error(`${label} failed`));
      }
      return Promise.resolve({ text: label, inputTokens: 10, outputTokens: 20 });
    },
    completeJson: () => {
      if (opts?.fails) {
        return Promise.reject(new Error(`${label} failed`));
      }
      return Promise.resolve({ data: { from: label }, inputTokens: 10, outputTokens: 20 });
    },
  };
}

class FakeSink implements LlmUsageSink {
  entries: Array<{
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }> = [];
  insert(entry: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): Promise<unknown> {
    this.entries.push(entry);
    return Promise.resolve(entry);
  }
}

const silentLogger = { warn: () => undefined, error: () => undefined };

const textRequest = {
  model: "claude-sonnet-5",
  system: "s",
  messages: [{ role: "user" as const, content: "c" }],
  maxTokens: 100,
};

describe("ProviderFallbackLlmClient", () => {
  it("returns the inner client's result and logs usage on success", async () => {
    const sink = new FakeSink();
    const client = new ProviderFallbackLlmClient({
      inner: makeClient("inner", { modelLabel: "gemini-2.0-flash-lite" }),
      fallback: makeClient("fallback"),
      providerName: "gemini",
      logger: silentLogger,
      usageSink: sink,
    });
    const result = await client.completeText(textRequest);
    expect(result.text).toBe("inner");
    expect(sink.entries).toEqual([
      {
        provider: "gemini",
        model: "gemini-2.0-flash-lite",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0,
      },
    ]);
  });

  it("falls back to the No-LLM client on any error from the inner client", async () => {
    const sink = new FakeSink();
    const client = new ProviderFallbackLlmClient({
      inner: makeClient("inner", { fails: true }),
      fallback: makeClient("fallback"),
      providerName: "gemini",
      logger: silentLogger,
      usageSink: sink,
    });
    const result = await client.completeText(textRequest);
    expect(result.text).toBe("fallback");
    expect(sink.entries).toHaveLength(0);
  });

  it("attaches the describeError reason to the fallback result", async () => {
    const client = new ProviderFallbackLlmClient({
      inner: makeClient("inner", { fails: true }),
      fallback: makeClient("fallback"),
      providerName: "cloudflare",
      logger: silentLogger,
      describeError: () => "quota_exceeded",
    });
    const result = await client.completeText(textRequest);
    expect(result.isFallback).toBe(true);
    expect(result.fallbackReason).toBe("quota_exceeded");
  });

  it("falls back for completeJson the same way", async () => {
    const client = new ProviderFallbackLlmClient({
      inner: makeClient("inner", { fails: true }),
      fallback: makeClient("fallback"),
      providerName: "gemini",
      logger: silentLogger,
    });
    const result = await client.completeJson({
      ...textRequest,
      jsonSchema: { type: "object", additionalProperties: false },
    });
    expect(result.data).toEqual({ from: "fallback" });
  });

  it("exposes the inner client's modelLabel even after a fallback", async () => {
    const client = new ProviderFallbackLlmClient({
      inner: makeClient("inner", { fails: true, modelLabel: "gemini-2.0-flash-lite" }),
      fallback: makeClient("fallback"),
      providerName: "gemini",
      logger: silentLogger,
    });
    expect(client.modelLabel).toBe("gemini-2.0-flash-lite");
  });

  it("applies a custom cost estimator when provided", async () => {
    const sink = new FakeSink();
    const client = new ProviderFallbackLlmClient({
      inner: makeClient("inner", { modelLabel: "some-model" }),
      fallback: makeClient("fallback"),
      providerName: "anthropic-ish",
      logger: silentLogger,
      usageSink: sink,
      estimateCostUsd: (_model, inputTokens, outputTokens) => (inputTokens + outputTokens) / 1000,
    });
    await client.completeText(textRequest);
    expect(sink.entries[0]!.costUsd).toBeCloseTo(0.03);
  });

  it("still returns the inner result when usage recording fails", async () => {
    const client = new ProviderFallbackLlmClient({
      inner: makeClient("inner"),
      fallback: makeClient("fallback"),
      providerName: "gemini",
      logger: silentLogger,
      usageSink: {
        insert: () => Promise.reject(new Error("db down")),
      },
    });
    const result = await client.completeText(textRequest);
    expect(result.text).toBe("inner");
  });
});
