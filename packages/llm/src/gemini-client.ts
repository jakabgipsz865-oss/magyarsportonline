import type {
  JsonCompletionRequest,
  JsonCompletionResult,
  LlmClient,
  LlmMessage,
  TextCompletionRequest,
  TextCompletionResult,
} from "./client";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Ingyenes tierben elérhető, stabil Gemini modell — felülírható a
 * `GEMINI_MODEL` env változóval kód nélkül, ha Google időközben megváltoztatja
 * a free-tier kínálatot. Egy esetleges elavult/érvénytelen modellnév a Gemini
 * API-tól HTTP hibát kap, amit a ProviderFallbackLlmClient automatikusan
 * No-LLM módra fordít — a rendszer emiatt sosem áll le (lásd
 * provider-fallback-client.ts).
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash-lite";

export interface GeminiLlmClientOptions {
  apiKey: string;
  /** Alapértelmezés: DEFAULT_GEMINI_MODEL. Üres string esetén is az alapértelmezésre esik vissza. */
  model?: string;
  baseUrl?: string;
  /** Tesztelhetőség: injektálható fetch. */
  fetchImpl?: typeof fetch;
}

/** A Gemini API nem-2xx válaszát (vagy hálózati hibát) hordozó, kategorizálható hiba. */
export class GeminiApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly apiStatus: string | null,
    message: string,
  ) {
    super(message);
    this.name = "GeminiApiError";
  }
}

/**
 * Csak naplózási célra: rövid, ember-olvasható kategória a hibáról. NEM ez
 * dönti el, hogy történjen-e fallback — a ProviderFallbackLlmClient minden
 * hibára fallback-el, ez a függvény kizárólag a log-üzenet tartalmát adja.
 */
export function describeGeminiError(error: unknown): string {
  if (error instanceof GeminiApiError) {
    if (error.status === 429 || error.apiStatus === "RESOURCE_EXHAUSTED") {
      return "quota_exceeded";
    }
    if (error.status === 403 || error.apiStatus === "PERMISSION_DENIED") {
      return "forbidden";
    }
    if (error.apiStatus === "BLOCKED") {
      return "content_blocked";
    }
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
    candidatesTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
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
    const parsed = JSON.parse(errorBody) as { error?: { status?: string } };
    return parsed.error?.status ?? null;
  } catch {
    return null;
  }
}

/**
 * Raw HTTP-alapú Gemini API kliens (nincs `@google/...` SDK-függőség —
 * kevesebb dolog, ami elavulhat/build-et törhet egy free-tier teszthez).
 *
 * A `request.model` mezőt SZÁNDÉKOSAN figyelmen kívül hagyja: a hívó
 * agentek (packages/agents/src/fact-verification, hungarian-writer) az
 * Anthropic-specifikus `MODEL_TIERS` logikai neveit küldik ott
 * ("claude-haiku-4-5" stb., lásd model-router.ts) — ez a kliens mindig a
 * saját, konstruktorban/env-ből kapott egyetlen modelljét hívja, azt a
 * `modelLabel` getter teszi láthatóvá a hívó (Hungarian Writer Agent)
 * számára a `StoryVersion.generated_by_model` helyes kitöltéséhez.
 */
export class GeminiLlmClient implements LlmClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiLlmClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || DEFAULT_GEMINI_MODEL;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
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
    };
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    const response = await this.generateContent(request, true);
    const text = extractText(response);
    return {
      data: JSON.parse(stripMarkdownFence(text)) as unknown,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  private async generateContent(
    request: TextCompletionRequest,
    wantsJson: boolean,
  ): Promise<GeminiGenerateContentResponse> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const body = {
      system_instruction: { parts: [{ text: request.system }] },
      contents: request.messages.map((message) => ({
        role: toGeminiRole(message.role),
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        ...(wantsJson ? { responseMimeType: "application/json" } : {}),
      },
    };

    let httpResponse: Response;
    try {
      httpResponse = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new GeminiApiError(
        0,
        null,
        `Gemini API network error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!httpResponse.ok) {
      const errorBody = await httpResponse.text().catch(() => "");
      throw new GeminiApiError(
        httpResponse.status,
        parseApiStatus(errorBody),
        `Gemini API error ${httpResponse.status}: ${errorBody.slice(0, 500)}`,
      );
    }

    const parsed = (await httpResponse.json()) as GeminiGenerateContentResponse;
    if (parsed.promptFeedback?.blockReason) {
      throw new GeminiApiError(
        0,
        "BLOCKED",
        `Gemini blocked the request: ${parsed.promptFeedback.blockReason}`,
      );
    }
    return parsed;
  }
}
