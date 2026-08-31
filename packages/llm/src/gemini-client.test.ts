import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GEMINI_MODEL,
  GeminiApiError,
  GeminiLlmClient,
  describeGeminiError,
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
        jsonResponse({ candidates: [{ content: { parts: [{ text: "not-json" }] } }] }),
      ),
    });
    await expect(
      client.completeJson({ ...textRequest, jsonSchema: { type: "object" } }),
    ).rejects.toMatchObject({ apiStatus: "INVALID_SCHEMA" });
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
    expect(describeGeminiError(new GeminiApiError(0, "TIMEOUT", "x"))).toBe("timeout");
    expect(describeGeminiError(new GeminiApiError(503, null, "x"))).toBe("service_unavailable");
    expect(describeGeminiError(new GeminiApiError(0, null, "x"))).toBe("network_error");
    expect(describeGeminiError(new Error("boom"))).toBe("unknown_error");
  });
});
