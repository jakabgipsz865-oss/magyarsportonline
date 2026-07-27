import Anthropic from "@anthropic-ai/sdk";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /**
   * true, ha ez a konkrét hívás egy fallback kliens (jellemzően
   * NoLlmClient) válasza, mert a valódi provider hívása hibázott — a
   * ProviderFallbackLlmClient és a BudgetGuardedLlmClient állítja be a
   * saját fallback-águkban. A Hungarian Writer Agent ez alapján dönti el
   * helyesen az `isAiGenerated`/`generated_by_model` mezőket, mert
   * `deps.llm instanceof NoLlmClient` önmagában hamis maradna egy
   * becsomagolt kliens fallback-ága esetén is (lásd hungarian-writer/index.ts).
   */
  isFallback?: boolean | undefined;
}

export interface TextCompletionRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
}

export interface TextCompletionResult extends LlmUsage {
  text: string;
}

export interface JsonCompletionRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  /** Raw JSON Schema (not a Zod schema) — see structured-outputs limitations: no min/maxLength, `additionalProperties: false` required on every object. */
  jsonSchema: Record<string, unknown>;
}

export interface JsonCompletionResult extends LlmUsage {
  /** Caller validates/narrows this with its own Zod schema — this client stays schema-library-agnostic. */
  data: unknown;
}

/**
 * Narrow LLM client interface used by the Fact Verification and Hungarian
 * Writer agents (docs/architecture/02-agents.md §2.4, §2.5). Deliberately
 * small surface so agent unit tests can inject a fake implementation instead
 * of calling the real Anthropic API (see fake-client.ts).
 */
export interface LlmClient {
  completeText(request: TextCompletionRequest): Promise<TextCompletionResult>;
  completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult>;
  /**
   * A ténylegesen válaszoló modell neve, ha az eltér(het) a hívó által a
   * `request.model` mezőben küldött logikai tier-névtől (pl. a
   * GeminiLlmClient mindig a saját konfigurált modelljét használja,
   * függetlenül a MODEL_TIERS Anthropic-specifikus értékeitől — lásd
   * gemini-client.ts). Hiányában (pl. AnthropicLlmClient) a hívó a
   * `request.model` értékét tekinti helyesnek. Kizárólag a Hungarian
   * Writer Agent `StoryVersion.generated_by_model` mezőjének helyes
   * kitöltéséhez kell (hungarian-writer/index.ts).
   *
   * `| undefined` explicit kiírása szükséges `exactOptionalPropertyTypes`
   * mellett, mert a ProviderFallbackLlmClient a becsomagolt kliens
   * `modelLabel`-jét adja tovább változtatás nélkül, ami maga is hiányozhat.
   */
  readonly modelLabel?: string | undefined;
}

class RefusalError extends Error {
  constructor(public readonly category: string | null) {
    super(`LLM declined the request (stop_reason=refusal, category=${category ?? "unknown"})`);
    this.name = "RefusalError";
  }
}

export { RefusalError };

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Thin wrapper around the Anthropic SDK (docs/architecture/05-repo-structure.md
 * `packages/llm`). Takes the API key as a constructor parameter rather than
 * reading `process.env` directly, matching `@magyarsportonline/db`'s
 * `createDatabaseClient` convention — this package stays usable from any
 * runtime and testable without a real key.
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async completeText(request: TextCompletionRequest): Promise<TextCompletionResult> {
    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages,
    });

    if (response.stop_reason === "refusal") {
      throw new RefusalError(response.stop_details?.category ?? null);
    }

    return {
      text: extractText(response.content),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages,
      output_config: {
        format: {
          type: "json_schema",
          schema: request.jsonSchema,
        },
      },
    });

    if (response.stop_reason === "refusal") {
      throw new RefusalError(response.stop_details?.category ?? null);
    }

    const text = extractText(response.content);
    return {
      data: JSON.parse(text) as unknown,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}
