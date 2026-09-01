import { describe, expect, it, vi } from "vitest";
import {
  CloudflareApiError,
  CloudflareWorkersAiLlmClient,
  DEFAULT_CLOUDFLARE_MODEL,
  FAST_CLOUDFLARE_MODEL,
  describeCloudflareError,
  isCloudflareDailyNeuronQuotaError,
} from "./cloudflare-client";
import { MODEL_TIERS } from "./model-router";

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function structuredResponse(response: unknown, usage = { prompt_tokens: 3, completion_tokens: 2 }) {
  return jsonResponse({ result: { response, usage }, success: true, errors: [] });
}

const textRequest = {
  model: "claude-sonnet-5", // MODEL_TIERS-style logikai név — a kliens Cloudflare production modellre route-olja
  system: "system prompt",
  messages: [{ role: "user" as const, content: "hello" }],
  maxTokens: 100,
};

const JSON_SCHEMA = {
  type: "object",
  properties: { title_hu: { type: "string" }, lead_hu: { type: "string" } },
  required: ["title_hu", "lead_hu"],
  additionalProperties: false,
} as const;

describe("CloudflareWorkersAiLlmClient", () => {
  it("reports the free-tier production model when none is configured", () => {
    const client = new CloudflareWorkersAiLlmClient({ accountId: "acc", apiToken: "tok" });
    expect(client.modelLabel).toBe(FAST_CLOUDFLARE_MODEL);
  });

  it("routes the writing tier to the free-tier model even when a larger model is configured", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://api.cloudflare.com/client/v4/accounts/acc-123/ai/v1/chat/completions",
      );
      expect(init?.headers).toMatchObject({
        authorization: "Bearer secret-token",
        "x-session-affinity": "magyarsportonline-production-v1",
      });
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        temperature: number;
        repetition_penalty: number;
        frequency_penalty: number;
      };
      expect(body).toMatchObject({
        model: FAST_CLOUDFLARE_MODEL,
        temperature: 0.2,
        repetition_penalty: 1.1,
        frequency_penalty: 0.2,
      });
      return jsonResponse({
        choices: [{ message: { content: "válasz" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    });
    const client = new CloudflareWorkersAiLlmClient({
      accountId: "acc-123",
      apiToken: "secret-token",
      model: "@cf/meta/llama-3.1-70b-instruct",
      fetchImpl,
    });
    const result = await client.completeText(textRequest);
    expect(result).toEqual({ text: "válasz", inputTokens: 10, outputTokens: 5 });
  });

  it("routes extraction to 70B while self-check stays on 8B", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrls.push(String(url));
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
      });
      return structuredResponse(
        { title_hu: "Cím", lead_hu: "Lead" },
        { prompt_tokens: 4, completion_tokens: 3 },
      );
    });
    const client = new CloudflareWorkersAiLlmClient({
      accountId: "acc",
      apiToken: "tok",
      fetchImpl,
    });

    await client.completeJson({
      ...textRequest,
      model: MODEL_TIERS.extraction,
      jsonSchema: JSON_SCHEMA,
    });
    await client.completeJson({
      ...textRequest,
      model: MODEL_TIERS.selfCheck,
      jsonSchema: JSON_SCHEMA,
    });

    expect(requestedUrls).toEqual([
      `https://api.cloudflare.com/client/v4/accounts/acc/ai/run/${DEFAULT_CLOUDFLARE_MODEL}`,
      `https://api.cloudflare.com/client/v4/accounts/acc/ai/run/${FAST_CLOUDFLARE_MODEL}`,
    ]);
    expect(client.modelLabel).toBe(FAST_CLOUDFLARE_MODEL);
  });

  it("reports the free-tier model when an unsupported model is configured", () => {
    const client = new CloudflareWorkersAiLlmClient({
      accountId: "acc",
      apiToken: "tok",
      model: "@cf/qwen/qwen3-30b-a3b-fp8",
    });
    expect(client.modelLabel).toBe(FAST_CLOUDFLARE_MODEL);
  });

  it("parses JSON completions, including markdown-fenced output", async () => {
    const fetchImpl = vi.fn(async () =>
      structuredResponse('```json\n{"title_hu": "Cím", "lead_hu": "Lead"}\n```'),
    );
    const client = new CloudflareWorkersAiLlmClient({
      accountId: "acc",
      apiToken: "tok",
      fetchImpl,
    });
    const result = await client.completeJson({ ...textRequest, jsonSchema: JSON_SCHEMA });
    expect(result.data).toEqual({ title_hu: "Cím", lead_hu: "Lead" });
  });

  it("accepts JSON Mode content returned by Cloudflare as an object", async () => {
    const fetchImpl = vi.fn(async () => structuredResponse({ title_hu: "Cím", lead_hu: "Lead" }));
    const client = new CloudflareWorkersAiLlmClient({
      accountId: "acc",
      apiToken: "tok",
      fetchImpl,
    });
    const result = await client.completeJson({ ...textRequest, jsonSchema: JSON_SCHEMA });
    expect(result.data).toEqual({ title_hu: "Cím", lead_hu: "Lead" });
  });

  it("throws a schema_error when a required field is missing from the response", async () => {
    const fetchImpl = vi.fn(async () => structuredResponse({ title_hu: "Cím csak" }));
    const client = new CloudflareWorkersAiLlmClient({
      accountId: "acc",
      apiToken: "tok",
      fetchImpl,
    });
    await expect(
      client.completeJson({ ...textRequest, jsonSchema: JSON_SCHEMA }),
    ).rejects.toMatchObject({ kind: "schema_error" });
  });

  it("throws a parse_error when the response is not valid JSON", async () => {
    const fetchImpl = vi.fn(async () => structuredResponse("nem JSON szöveg"));
    const client = new CloudflareWorkersAiLlmClient({
      accountId: "acc",
      apiToken: "tok",
      fetchImpl,
    });
    await expect(
      client.completeJson({ ...textRequest, jsonSchema: JSON_SCHEMA }),
    ).rejects.toMatchObject({ kind: "parse_error" });
  });

  it("throws an http error with status on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [{ code: 10000, message: "rate limited" }] }, { status: 429 }),
    );
    const client = new CloudflareWorkersAiLlmClient({
      accountId: "acc",
      apiToken: "tok",
      fetchImpl,
    });
    await expect(client.completeText(textRequest)).rejects.toMatchObject({
      kind: "http",
      status: 429,
    });
  });

  it("throws an error_envelope error when Cloudflare returns 2xx with an errors array", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [{ code: 5006, message: "model not found" }] }),
    );
    const client = new CloudflareWorkersAiLlmClient({
      accountId: "acc",
      apiToken: "tok",
      fetchImpl,
    });
    await expect(client.completeText(textRequest)).rejects.toMatchObject({
      kind: "error_envelope",
    });
  });

  it("throws a network error on fetch failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const client = new CloudflareWorkersAiLlmClient({
      accountId: "acc",
      apiToken: "tok",
      fetchImpl,
    });
    await expect(client.completeText(textRequest)).rejects.toMatchObject({ kind: "network" });
  });

  it("aborts a provider call at the configured request deadline", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("timed out", "TimeoutError")),
          );
        }),
    );
    const client = new CloudflareWorkersAiLlmClient({
      accountId: "acc",
      apiToken: "tok",
      fetchImpl,
      requestTimeoutMs: 5,
    });
    await expect(client.completeText(textRequest)).rejects.toMatchObject({
      kind: "network",
      message: "Cloudflare Workers AI request timed out after 5 ms",
    });
  });
});

describe("describeCloudflareError", () => {
  it("classifies every error kind and http status bucket", () => {
    expect(describeCloudflareError(new CloudflareApiError("network", 0, "x"))).toBe(
      "network_error",
    );
    expect(describeCloudflareError(new CloudflareApiError("parse_error", 0, "x"))).toBe(
      "invalid_json_output",
    );
    expect(describeCloudflareError(new CloudflareApiError("schema_error", 0, "x"))).toBe(
      "schema_mismatch",
    );
    expect(describeCloudflareError(new CloudflareApiError("error_envelope", 0, "x"))).toBe(
      "api_error_envelope",
    );
    expect(describeCloudflareError(new CloudflareApiError("http", 429, "x"))).toBe(
      "quota_exceeded",
    );
    expect(describeCloudflareError(new CloudflareApiError("http", 401, "x"))).toBe("forbidden");
    expect(describeCloudflareError(new CloudflareApiError("http", 403, "x"))).toBe("forbidden");
    expect(describeCloudflareError(new CloudflareApiError("http", 503, "x"))).toBe(
      "service_unavailable",
    );
    expect(describeCloudflareError(new CloudflareApiError("http", 400, "x"))).toBe("http_400");
    expect(describeCloudflareError(new Error("boom"))).toBe("unknown_error");
  });
});

describe("isCloudflareDailyNeuronQuotaError", () => {
  it("distinguishes the daily neuron allocation from a transient 429", () => {
    expect(
      isCloudflareDailyNeuronQuotaError(
        new CloudflareApiError(
          "http",
          429,
          "Cloudflare Workers AI error 429: daily free allocation of 10,000 neurons exceeded",
        ),
      ),
    ).toBe(true);
    expect(
      isCloudflareDailyNeuronQuotaError(
        new CloudflareApiError("http", 429, "Cloudflare Workers AI error 429: rate limited"),
      ),
    ).toBe(false);
  });
});
