import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GEMINI_MODEL,
  GeminiApiError,
  GeminiLlmClient,
  describeGeminiError,
  isGeminiDefinitelyUnmeteredError,
} from "./gemini-client";

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

const textRequest = {
  model: "claude-sonnet-5", // MODEL_TIERS-style logikai név — a Gemini kliens ezt szándékosan figyelmen kívül hagyja
  system: "system prompt",
  messages: [{ role: "user" as const, content: "hello" }],
  maxTokens: 100,
};

describe("GeminiLlmClient", () => {
  it("uses the default model when none is configured", () => {
    const client = new GeminiLlmClient({ apiKey: "key" });
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
    expect(client.modelLabel).toBe(DEFAULT_GEMINI_MODEL);
  });

  it("uses the configured GEMINI_MODEL, ignoring request.model", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/models/gemini-custom-model:generateContent");
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: "válasz" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      });
    });
    const client = new GeminiLlmClient({ apiKey: "key", model: "gemini-custom-model", fetchImpl });
    const result = await client.completeText(textRequest);
    expect(result).toEqual({ text: "válasz", inputTokens: 10, outputTokens: 5 });
    expect(client.modelLabel).toBe("gemini-custom-model");
  });

  it("parses JSON completions, including markdown-fenced output", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { generationConfig: Record<string, unknown> };
      expect(body.generationConfig["responseMimeType"]).toBe("application/json");
      expect(body.generationConfig["responseJsonSchema"]).toEqual({
        type: "object",
        additionalProperties: false,
      });
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: '```json\n{"ok": true}\n```' }] } }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
      });
    });
    const client = new GeminiLlmClient({ apiKey: "key", fetchImpl });
    const result = await client.completeJson({
      ...textRequest,
      jsonSchema: { type: "object", additionalProperties: false },
    });
    expect(result.data).toEqual({ ok: true });
  });

  it("sends minimal thinking for the Gemini Writer request", async () => {
    const usageLog = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { generationConfig: Record<string, unknown> };
      expect(body.generationConfig["thinkingConfig"]).toEqual({ thinkingLevel: "minimal" });
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 9,
          thoughtsTokenCount: 1,
          candidatesTokenCount: 3,
          totalTokenCount: 13,
        },
      });
    });
    const client = new GeminiLlmClient({ apiKey: "key", model: "gemini-3.5-flash", fetchImpl });
    await client.completeJson({
      ...textRequest,
      thinkingLevel: "minimal",
      jsonSchema: { type: "object" },
    });
    expect(usageLog).toHaveBeenCalledWith(
      JSON.stringify({
        event: "gemini_usage",
        model: "gemini-3.5-flash",
        finishReason: "STOP",
        promptTokenCount: 9,
        thoughtsTokenCount: 1,
        candidatesTokenCount: 3,
        totalTokenCount: 13,
      }),
    );
    usageLog.mockRestore();
  });

  it("throws GeminiApiError with the status and apiStatus on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: { code: 429, message: "quota exceeded", status: "RESOURCE_EXHAUSTED" } },
        { status: 429 },
      ),
    );
    const client = new GeminiLlmClient({ apiKey: "key", fetchImpl });
    await expect(client.completeText(textRequest)).rejects.toMatchObject({
      status: 429,
      apiStatus: "RESOURCE_EXHAUSTED",
    });
  });

  it("throws GeminiApiError(status=0) on a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const client = new GeminiLlmClient({ apiKey: "key", fetchImpl });
    await expect(client.completeText(textRequest)).rejects.toMatchObject({ status: 0 });
  });

  it("throws when the response was blocked by safety filters", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ promptFeedback: { blockReason: "SAFETY" } }),
    );
    const client = new GeminiLlmClient({ apiKey: "key", fetchImpl });
    await expect(client.completeText(textRequest)).rejects.toMatchObject({ apiStatus: "BLOCKED" });
  });

  it("fails closed when a structured response is malformed JSON", async () => {
    const client = new GeminiLlmClient({
      apiKey: "key",
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "not-json" }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 },
        }),
      ),
    });
    await expect(
      client.completeJson({ ...textRequest, jsonSchema: { type: "object" } }),
    ).rejects.toMatchObject({
      apiStatus: "INVALID_SCHEMA",
      finishReason: "STOP",
      meteredUsage: { inputTokens: 11, outputTokens: 7 },
    });
  });

  it("classifies MAX_TOKENS as a metered truncated output before JSON parsing", async () => {
    const client = new GeminiLlmClient({
      apiKey: "key",
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          candidates: [{ content: { parts: [{ text: '{"cut":' }] }, finishReason: "MAX_TOKENS" }],
          usageMetadata: {
            promptTokenCount: 101,
            thoughtsTokenCount: 2900,
            candidatesTokenCount: 48,
            totalTokenCount: 3049,
          },
        }),
      ),
    });
    await expect(
      client.completeJson({ ...textRequest, jsonSchema: { type: "object" } }),
    ).rejects.toMatchObject({
      status: 200,
      apiStatus: "OUTPUT_TRUNCATED",
      finishReason: "MAX_TOKENS",
      meteredUsage: { inputTokens: 101, outputTokens: 48 },
      message:
        "Gemini output truncated (promptTokens=101, thoughtsTokens=2900, candidateTokens=48, totalTokens=3049)",
    });
  });
});

describe("describeGeminiError", () => {
  it("classifies quota, forbidden, blocked, service and network errors", () => {
    expect(describeGeminiError(new GeminiApiError(429, "RESOURCE_EXHAUSTED", "x"))).toBe(
      "quota_exceeded",
    );
    expect(describeGeminiError(new GeminiApiError(403, "PERMISSION_DENIED", "x"))).toBe(
      "forbidden",
    );
    expect(describeGeminiError(new GeminiApiError(0, "BLOCKED", "x"))).toBe("content_blocked");
    expect(describeGeminiError(new GeminiApiError(0, "INVALID_SCHEMA", "x"))).toBe(
      "invalid_schema",
    );
    expect(describeGeminiError(new GeminiApiError(200, "OUTPUT_TRUNCATED", "x"))).toBe(
      "output_truncated",
    );
    expect(describeGeminiError(new GeminiApiError(0, "TIMEOUT", "x"))).toBe("timeout");
    expect(describeGeminiError(new GeminiApiError(503, null, "x"))).toBe("service_unavailable");
    expect(describeGeminiError(new GeminiApiError(0, null, "x"))).toBe("network_error");
    expect(describeGeminiError(new Error("boom"))).toBe("unknown_error");
  });
});

describe("isGeminiDefinitelyUnmeteredError", () => {
  it("releases only model-not-found reservations", () => {
    expect(isGeminiDefinitelyUnmeteredError(new GeminiApiError(404, "NOT_FOUND", "x"))).toBe(true);
    expect(
      isGeminiDefinitelyUnmeteredError(new GeminiApiError(429, "RESOURCE_EXHAUSTED", "x")),
    ).toBe(false);
    expect(isGeminiDefinitelyUnmeteredError(new GeminiApiError(0, null, "x"))).toBe(false);
  });
});
