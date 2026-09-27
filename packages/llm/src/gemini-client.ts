import type {
  JsonCompletionRequest,
  JsonCompletionResult,
  LlmClient,
  LlmMessage,
  TextCompletionRequest,
  TextCompletionResult,
} from "./client";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Writer model; production wraps this client in fail-closed daily request metering. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

export interface GeminiLlmClientOptions {
  /** Google API key for BYOK. Omit when Cloudflare Unified Billing supplies provider credentials. */
  apiKey?: string;
  /** Alapértelmezés: DEFAULT_GEMINI_MODEL. Üres string esetén is az alapértelmezésre esik vissza. */
  model?: string;
  baseUrl?: string;
  /** Optional Cloudflare AI Gateway authentication token. */
  gatewayToken?: string;
  /** Cloudflare REST API transport for provider-key-free Unified Billing. */
  unifiedBilling?: {
    accountId: string;
    apiToken: string;
    gatewayId: string;
  };
  /** Tesztelhetőség: injektálható fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** A Gemini API nem-2xx válaszát (vagy hálózati hibát) hordozó, kategorizálható hiba. */
export class GeminiApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly apiStatus: string | null,
    message: string,
    public readonly meteredUsage: { inputTokens: number; outputTokens: number } | null = null,
    public readonly finishReason: string | null = null,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "GeminiApiError";
  }
}

/** Stable error category for durable retry/defer decisions and diagnostics. */
export function describeGeminiError(error: unknown): string {
  if (error instanceof GeminiApiError) {
    if (error.apiStatus === "CLOUDFLARE_GATEWAY_RATE_LIMIT") return "gateway_rate_limited";
    if (isGeminiDailyQuotaError(error)) return "daily_quota_exceeded";
    if (error.status === 429 || error.apiStatus === "RESOURCE_EXHAUSTED") return "rate_limited";
    if (error.apiStatus === "CLOUDFLARE_API_ERROR") return "gateway_error";
    if (error.status === 403 || error.apiStatus === "PERMISSION_DENIED") {
      return "forbidden";
    }
    if (error.apiStatus === "BLOCKED") {
      return "content_blocked";
    }
    if (error.apiStatus === "OUTPUT_TRUNCATED") return "output_truncated";
    if (error.apiStatus === "INVALID_SCHEMA") return "invalid_schema";
    if (error.apiStatus === "TIMEOUT") return "timeout";
    if (error.status >= 500) {
      return "service_unavailable";
    }
    if (error.status === 0) {
      return "network_error";
    }
    return `http_${error.status}`;
  }
  return "unknown_error";
}

export function isGeminiDailyQuotaError(error: unknown): boolean {
  return (
    error instanceof GeminiApiError &&
    error.apiStatus !== "CLOUDFLARE_GATEWAY_RATE_LIMIT" &&
    (error.status === 429 || error.apiStatus === "RESOURCE_EXHAUSTED") &&
    /(?:requests? per day|per-day|daily (?:quota|limit)|\bRPD\b|quota.*\/day)/iu.test(error.message)
  );
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.ceil(seconds * 1000), 30 * 60_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(Math.max(0, date - Date.now()), 30 * 60_000) : null;
}

async function timedGeminiPhase<T>(
  phase: "request_headers" | "response_body",
  request: TextCompletionRequest | JsonCompletionRequest,
  model: string,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const context = {
    event: "gemini_phase",
    phase,
    model,
    jobId: request.usageContext?.jobId,
    rawArticleId: request.usageContext?.rawArticleId,
    storyId: request.usageContext?.storyId,
    role: request.usageContext?.role,
  };
  console.info(JSON.stringify({ ...context, status: "started" }));
  try {
    const result = await run();
    console.info(JSON.stringify({ ...context, status: "completed", durationMs: Date.now() - startedAt }));
    return result;
  } catch (error) {
    console.error(JSON.stringify({
      ...context,
      status: "failed",
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "unknown",
    }));
    throw error;
  }
}

/** A model-not-found response is rejected before generation and consumes no RPD request. */
export function isGeminiDefinitelyUnmeteredError(error: unknown): boolean {
  return error instanceof GeminiApiError && error.status === 404 && error.apiStatus === "NOT_FOUND";
}

function toGeminiRole(role: LlmMessage["role"]): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    thoughtsTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
}

interface CloudflareAiRunEnvelope {
  result?: GeminiGenerateContentResponse;
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
}

function extractText(response: GeminiGenerateContentResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part.text ?? "").join("");
}

/** A Gemini structured-JSON kimenete néha ```json fence-be csomagolva érkezik — ezt levágjuk parse előtt. */
function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? (fenced[1] ?? "").trim() : trimmed;
}

function parseApiStatus(errorBody: string): string | null {
  try {
    const parsed = JSON.parse(errorBody) as {
      error?: { status?: string };
      errors?: Array<{ code?: number }>;
    };
    if (parsed.errors?.some((entry) => entry.code === 2018))
      return "CLOUDFLARE_GATEWAY_RATE_LIMIT";
    return parsed.error?.status ?? null;
  } catch {
    return null;
  }
}

function unwrapCloudflareAiRunResponse(payload: unknown): GeminiGenerateContentResponse {
  if (typeof payload !== "object" || payload === null) {
    throw new GeminiApiError(200, "INVALID_RESPONSE", "Cloudflare AI returned an invalid response");
  }

  const envelope = payload as CloudflareAiRunEnvelope;
  if (envelope.success === false || (envelope.errors?.length ?? 0) > 0) {
    throw new GeminiApiError(
      200,
      "CLOUDFLARE_API_ERROR",
      `Cloudflare AI returned an error envelope: ${envelope.errors?.[0]?.message ?? "unknown error"}`,
    );
  }

  if (envelope.result) {
    return envelope.result;
  }

  // Kept for compatibility with injected test transports and any future
  // endpoint variant that returns the provider payload without a v4 envelope.
  return payload as GeminiGenerateContentResponse;
}

/**
 * Raw HTTP-alapú Gemini API kliens (nincs `@google/...` SDK-függőség —
 * kevesebb dolog, ami elavulhat/build-et törhet egy free-tier teszthez).
 *
 * A `request.model` mezőt szándékosan figyelmen kívül hagyja: a kliens mindig
 * a konstruktorban/env-ből kapott Writer-modellt hívja, azt a
 * `modelLabel` getter teszi láthatóvá a hívó (Hungarian Writer Agent)
 * számára a `StoryVersion.generated_by_model` helyes kitöltéséhez.
 */
export class GeminiLlmClient implements LlmClient {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly gatewayToken: string | undefined;
  private readonly unifiedBilling: GeminiLlmClientOptions["unifiedBilling"];

  constructor(options: GeminiLlmClientOptions) {
    if (!options.apiKey && !options.unifiedBilling) {
      throw new Error("Gemini requires either a Google API key or Cloudflare Unified Billing");
    }
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || DEFAULT_GEMINI_MODEL;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.gatewayToken = options.gatewayToken;
    this.unifiedBilling = options.unifiedBilling;
  }

  get modelLabel(): string {
    return this.model;
  }

  async completeText(request: TextCompletionRequest): Promise<TextCompletionResult> {
    const response = await this.generateContent(request, false);
    return {
      text: extractText(response),
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      modelLabel: this.model,
    };
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    const response = await this.generateContent(request, true);
    const text = extractText(response);
    const finishReason = response.candidates?.[0]?.finishReason ?? null;
    const usage = response.usageMetadata;
    console.info(
      JSON.stringify({
        event: "gemini_usage",
        model: this.model,
        finishReason,
        promptTokenCount: usage?.promptTokenCount ?? 0,
        thoughtsTokenCount: usage?.thoughtsTokenCount ?? 0,
        candidatesTokenCount: usage?.candidatesTokenCount ?? 0,
        totalTokenCount: usage?.totalTokenCount ?? 0,
      }),
    );
    const meteredUsage = {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    };
    if (finishReason === "MAX_TOKENS") {
      throw new GeminiApiError(
        200,
        "OUTPUT_TRUNCATED",
        `Gemini output truncated (promptTokens=${meteredUsage.inputTokens}, thoughtsTokens=${usage?.thoughtsTokenCount ?? 0}, candidateTokens=${meteredUsage.outputTokens}, totalTokens=${usage?.totalTokenCount ?? 0})`,
        meteredUsage,
        finishReason,
      );
    }
    let data: unknown;
    try {
      data = JSON.parse(stripMarkdownFence(text)) as unknown;
    } catch {
      throw new GeminiApiError(
        200,
        "INVALID_SCHEMA",
        `Gemini returned malformed JSON (finishReason=${finishReason ?? "UNKNOWN"}, promptTokens=${meteredUsage.inputTokens}, thoughtsTokens=${usage?.thoughtsTokenCount ?? 0}, candidateTokens=${meteredUsage.outputTokens}, totalTokens=${usage?.totalTokenCount ?? 0})`,
        meteredUsage,
        finishReason,
      );
    }
    return {
      data,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      modelLabel: this.model,
    };
  }

  private async generateContent(
    request: TextCompletionRequest | JsonCompletionRequest,
    wantsJson: boolean,
  ): Promise<GeminiGenerateContentResponse> {
    const geminiInput = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.messages.map((message) => ({
        role: toGeminiRole(message.role),
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        ...("thinkingLevel" in request && request.thinkingLevel
          ? { thinkingConfig: { thinkingLevel: request.thinkingLevel } }
          : {}),
        ...(wantsJson
          ? {
              responseMimeType: "application/json",
              responseJsonSchema: "jsonSchema" in request ? request.jsonSchema : undefined,
            }
          : {}),
      },
    };
    const url = this.unifiedBilling
      ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.unifiedBilling.accountId)}/ai/run`
      : `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`;
    const body = this.unifiedBilling
      ? { model: `google/${this.model}`, input: geminiInput }
      : geminiInput;

    let httpResponse: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      try {
        httpResponse = await timedGeminiPhase("request_headers", request, this.model, () => this.fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.unifiedBilling
              ? {
                  authorization: `Bearer ${this.unifiedBilling.apiToken}`,
                  "cf-aig-gateway-id": this.unifiedBilling.gatewayId,
                }
              : {
                  ...(this.apiKey ? { "x-goog-api-key": this.apiKey } : {}),
                  ...(this.gatewayToken
                    ? { "cf-aig-authorization": `Bearer ${this.gatewayToken}` }
                    : {}),
                }),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }));
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new GeminiApiError(
            0,
            "TIMEOUT",
            `Gemini API timed out after ${this.timeoutMs}ms`,
          );
        }
        throw new GeminiApiError(
          0,
          null,
          `Gemini API network error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (!httpResponse.ok) {
        let errorBody: string;
        try {
          errorBody = await timedGeminiPhase("response_body", request, this.model, () => httpResponse.text());
        } catch (error) {
          if (controller.signal.aborted)
            throw new GeminiApiError(0, "TIMEOUT", `Gemini API timed out after ${this.timeoutMs}ms`);
          throw error;
        }
        if (controller.signal.aborted)
          throw new GeminiApiError(0, "TIMEOUT", `Gemini API timed out after ${this.timeoutMs}ms`);
        throw new GeminiApiError(
          httpResponse.status,
          parseApiStatus(errorBody),
          `Gemini API error ${httpResponse.status}: ${errorBody.slice(0, 500)}`,
          null,
          null,
          retryAfterMs(httpResponse.headers.get("retry-after")),
        );
      }

      const payload = (await timedGeminiPhase("response_body", request, this.model, () => httpResponse.json())) as unknown;
      const parsed = this.unifiedBilling
        ? unwrapCloudflareAiRunResponse(payload)
        : (payload as GeminiGenerateContentResponse);
      if (parsed.promptFeedback?.blockReason) {
        throw new GeminiApiError(
          0,
          "BLOCKED",
          `Gemini blocked the request: ${parsed.promptFeedback.blockReason}`,
        );
      }
      return parsed;
    } catch (error) {
      if (controller.signal.aborted && !(error instanceof GeminiApiError)) {
        throw new GeminiApiError(0, "TIMEOUT", `Gemini API timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
