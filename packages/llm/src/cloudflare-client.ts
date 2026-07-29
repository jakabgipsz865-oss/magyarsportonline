import type {
  JsonCompletionRequest,
  JsonCompletionResult,
  LlmClient,
  TextCompletionRequest,
  TextCompletionResult,
} from "./client";

const API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Cloudflare JSON Mode-ot hivatalosan támogató, erős szerkesztési modell.
 * A korábbi Qwen3 alapmodell érvényes chat-válaszokat adott, de nincs a
 * JSON Mode támogatott modelljei között; productionben emiatt csonka és
 * hibás JSON, majd ismétlődő cikkek készültek.
 */
export const DEFAULT_CLOUDFLARE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Cloudflare által dokumentált JSON Mode modellazonosítók. */
const JSON_MODE_SUPPORTED_MODELS = new Set([
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.1-70b-instruct",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3-8b-instruct",
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta/llama-3.2-11b-vision-instruct",
  "@hf/nousresearch/hermes-2-pro-mistral-7b",
  "@hf/thebloke/deepseek-coder-6.7b-instruct-awq",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
]);

export interface CloudflareWorkersAiClientOptions {
  accountId: string;
  apiToken: string;
  /** Alapértelmezés: DEFAULT_CLOUDFLARE_MODEL. Üres string esetén is az alapértelmezésre esik vissza. */
  model?: string;
  baseUrl?: string;
  /** Tesztelhetőség: injektálható fetch. */
  fetchImpl?: typeof fetch;
}

export type CloudflareErrorKind =
  | "http"
  | "network"
  | "parse_error"
  | "schema_error"
  | "error_envelope";

/** A Cloudflare Workers AI hívás bármilyen hibáját hordozó, kategorizálható hiba. */
export class CloudflareApiError extends Error {
  constructor(
    public readonly kind: CloudflareErrorKind,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

/**
 * Csak naplózási célra: rövid, ember-olvasható kategória a hibáról. NEM ez
 * dönti el, hogy történjen-e fallback — a ProviderFallbackLlmClient minden
 * hibára fallback-el (4xx/5xx, kvóta, hálózati hiba, JSON parse-hiba és a
 * lentebbi séma-teljesség-ellenőrzés hibája egyaránt), ez a függvény
 * kizárólag a log-üzenet tartalmát adja.
 */
export function describeCloudflareError(error: unknown): string {
  if (error instanceof CloudflareApiError) {
    switch (error.kind) {
      case "network":
        return "network_error";
      case "parse_error":
        return "invalid_json_output";
      case "schema_error":
        return "schema_mismatch";
      case "error_envelope":
        return "api_error_envelope";
      case "http":
        if (error.status === 429) return "quota_exceeded";
        if (error.status === 401 || error.status === 403) return "forbidden";
        if (error.status >= 500) return "service_unavailable";
        return `http_${error.status}`;
    }
  }
  return "unknown_error";
}

interface CloudflareChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  /** A Workers AI REST wrapper néha ezen az OpenAI-kompatibilis úton is felteszi a saját hibaborítékát 2xx HTTP-státusz mellett. */
  errors?: Array<{ code?: number; message?: string }>;
}

function extractText(response: CloudflareChatCompletionResponse): string {
  return response.choices?.[0]?.message?.content ?? "";
}

/** A modell kimenete néha ```json fence-be csomagolva érkezik — ezt levágjuk parse előtt. */
function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? (fenced[1] ?? "").trim() : trimmed;
}

/**
 * Sekély, séma-könyvtár-független teljesség-ellenőrzés: a kért JSON Schema
 * saját `required` tömbje alapján ellenőrzi, hogy minden kötelező mező
 * jelen van-e a válaszban. Cloudflare dokumentációja szerint a JSON mode
 * NEM garantálja a séma-megfelelést minden modellnél — ez a nyílt forráskódú
 * modelleknél (mint a Qwen3) valós, gyakorlati kockázat, ezért ezt itt, az
 * adapter szintjén szűrjük ki, mielőtt a hívó agent (pl. Hungarian Writer)
 * a saját Zod sémájával próbálná parse-olni. Teljes JSON-Schema-validáció
 * helyett tudatosan csak a "required" mezők meglétét nézzük — a
 * `packages/llm` csomag szándékosan séma-könyvtár-agnosztikus marad
 * (client.ts).
 */
function assertRequiredFields(data: unknown, jsonSchema: Record<string, unknown>): void {
  const required = jsonSchema["required"];
  if (!Array.isArray(required)) {
    return;
  }
  if (typeof data !== "object" || data === null) {
    throw new CloudflareApiError(
      "schema_error",
      0,
      "Cloudflare Workers AI response is not a JSON object matching the requested schema",
    );
  }
  const record = data as Record<string, unknown>;
  const missing = required.filter((key) => typeof key === "string" && !(key in record));
  if (missing.length > 0) {
    throw new CloudflareApiError(
      "schema_error",
      0,
      `Cloudflare Workers AI response is missing required schema fields: ${missing.join(", ")}`,
    );
  }
}

/**
 * Raw HTTP-alapú Cloudflare Workers AI kliens (nincs `@cloudflare/...`
 * SDK-függőség) — a Vercelről közvetlenül hívja a Workers AI
 * OpenAI-kompatibilis `/ai/v1/chat/completions` végpontját. NEM Cloudflare
 * Workerre települve fut, nincs Workers-deploy — csak egy plusz kimenő
 * HTTP-hívás a meglévő Vercel serverless függvényből
 * (docs/infrastructure-setup.md).
 *
 * Az OpenAI-kompatibilis végpontot választottuk a natív `/ai/run/{model}`
 * helyett: a válasz alakja (`choices[].message.content`,
 * `usage.prompt_tokens`/`completion_tokens`) stabil, jól dokumentált
 * szerződés, míg a natív végpont mezőnevei modellenként eltérhetnek.
 *
 * `CLOUDFLARE_API_TOKEN` kizárólag ebből a szerveroldali modulból
 * (apps/web/lib/llm.ts, a Next.js szerver-futtatókörnyezetből) érhető el —
 * sosem kerül a kliens-oldali bundle-be (apps/web/lib/env.ts `server`
 * blokkja, nem `client`).
 */
export class CloudflareWorkersAiLlmClient implements LlmClient {
  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CloudflareWorkersAiClientOptions) {
    this.accountId = options.accountId;
    this.apiToken = options.apiToken;
    const configuredModel = options.model?.trim() || DEFAULT_CLOUDFLARE_MODEL;
    // A pipeline minden érdemi agent-hívása strukturált JSON-t kér. Ha az
    // env-ben maradt modell ezt hivatalosan nem támogatja, ne próbáljuk meg
    // reménykedve parse-olni a szabad szöveges választ: használjuk a
    // dokumentált production alapmodellt.
    this.model = JSON_MODE_SUPPORTED_MODELS.has(configuredModel)
      ? configuredModel
      : DEFAULT_CLOUDFLARE_MODEL;
    this.baseUrl = options.baseUrl ?? API_BASE;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get modelLabel(): string {
    return this.model;
  }

  async completeText(request: TextCompletionRequest): Promise<TextCompletionResult> {
    const response = await this.chatCompletion(request, undefined);
    return {
      text: extractText(response),
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    const response = await this.chatCompletion(request, request.jsonSchema);
    const text = extractText(response);

    let data: unknown;
    try {
      data = JSON.parse(stripMarkdownFence(text));
    } catch (error) {
      throw new CloudflareApiError(
        "parse_error",
        0,
        `Cloudflare Workers AI returned non-JSON output: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    assertRequiredFields(data, request.jsonSchema);

    return {
      data,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  }

  private async chatCompletion(
    request: TextCompletionRequest,
    jsonSchema: Record<string, unknown> | undefined,
  ): Promise<CloudflareChatCompletionResponse> {
    const url = `${this.baseUrl}/accounts/${encodeURIComponent(this.accountId)}/ai/v1/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: request.system },
        ...request.messages.map((message) => ({ role: message.role, content: message.content })),
      ],
      max_tokens: request.maxTokens,
      // Szerkesztési feladatnál az alacsonyabb véletlenszerűség és a
      // repetíciós büntetés csökkenti a productionben megfigyelt, többször
      // visszamásolt bekezdéseket. Mindhárom paraméter része a Cloudflare
      // text-generation API dokumentált szerződésének.
      temperature: 0.2,
      repetition_penalty: 1.1,
      frequency_penalty: 0.2,
      ...(jsonSchema ? { response_format: { type: "json_schema", json_schema: jsonSchema } } : {}),
    };

    let httpResponse: Response;
    try {
      httpResponse = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new CloudflareApiError(
        "network",
        0,
        `Cloudflare Workers AI network error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!httpResponse.ok) {
      const errorBody = await httpResponse.text().catch(() => "");
      throw new CloudflareApiError(
        "http",
        httpResponse.status,
        `Cloudflare Workers AI error ${httpResponse.status}: ${errorBody.slice(0, 500)}`,
      );
    }

    const parsed = (await httpResponse.json()) as CloudflareChatCompletionResponse;
    if (parsed.errors && parsed.errors.length > 0) {
      throw new CloudflareApiError(
        "error_envelope",
        0,
        `Cloudflare Workers AI returned an error envelope: ${parsed.errors[0]?.message ?? "unknown"}`,
      );
    }
    return parsed;
  }
}
