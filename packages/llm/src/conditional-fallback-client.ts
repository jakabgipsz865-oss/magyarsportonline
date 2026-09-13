import type {
  JsonCompletionRequest,
  JsonCompletionResult,
  LlmClient,
  TextCompletionRequest,
  TextCompletionResult,
} from "./client";

/**
 * Switches to a second real LLM only for explicitly classified failures.
 * Unlike ProviderFallbackLlmClient's local No-LLM compatibility branch,
 * this keeps the result AI-generated and records the model that answered.
 */
export class ConditionalFallbackLlmClient implements LlmClient {
  constructor(
    private readonly primary: LlmClient,
    private readonly fallback: LlmClient,
    private readonly shouldFallback: (error: unknown) => boolean,
  ) {}

  get modelLabel(): string | undefined {
    return this.primary.modelLabel;
  }

  async completeText(request: TextCompletionRequest): Promise<TextCompletionResult> {
    try {
      const result = await this.primary.completeText(request);
      return { ...result, modelLabel: result.modelLabel ?? this.primary.modelLabel };
    } catch (error) {
      if (!this.shouldFallback(error)) throw error;
      const result = await this.fallback.completeText(request);
      return { ...result, modelLabel: result.modelLabel ?? this.fallback.modelLabel };
    }
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    try {
      const result = await this.primary.completeJson(request);
      return { ...result, modelLabel: result.modelLabel ?? this.primary.modelLabel };
    } catch (error) {
      if (!this.shouldFallback(error)) throw error;
      const result = await this.fallback.completeJson(request);
      return { ...result, modelLabel: result.modelLabel ?? this.fallback.modelLabel };
    }
  }
}
