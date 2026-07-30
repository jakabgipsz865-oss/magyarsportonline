import type {
  JsonCompletionRequest,
  JsonCompletionResult,
  LlmClient,
  TextCompletionRequest,
  TextCompletionResult,
} from "./client";

/** Sikeres (nem-fallback) hívások napló-sinkje — provider-agnosztikus, a `llm_usage` táblát tölti. */
export interface LlmUsageSink {
  insert(entry: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): Promise<unknown>;
}

export interface ProviderFallbackLogger {
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface ProviderFallbackOptions {
  /** A valódi kliens. */
  inner: LlmClient;
  /** Csak nem-production, `failClosed: false` módban használt fallback kliens. */
  fallback: LlmClient;
  providerName: string;
  logger: ProviderFallbackLogger;
  usageSink?: LlmUsageSink;
  /** Alapértelmezés: 0, ha a hívó nem ad költségmodellt. */
  estimateCostUsd?: (model: string, inputTokens: number, outputTokens: number) => number;
  /** Csak a naplóüzenet tartalmához — nem befolyásolja, hogy történik-e fallback. */
  describeError?: (error: unknown) => string;
  /**
   * Production content generation must never turn a provider outage into a
   * schema-valid No-LLM article. When true, the provider error is logged and
   * rethrown so the durable pipeline job can retry with backoff.
   */
  failClosed?: boolean;
}

/**
 * Usage-metering és hibakezelő dekorátor. `failClosed: true` mellett
 * minden provider-hibát újradob a tartós queue-nak; productionben ez az
 * egyetlen engedélyezett működés. A fallback ág kizárólag explicit helyi
 * kompatibilitási mód.
 */
export class ProviderFallbackLlmClient implements LlmClient {
  constructor(private readonly options: ProviderFallbackOptions) {}

  /** A tényleges production modell neve. */
  get modelLabel(): string | undefined {
    return this.options.inner.modelLabel;
  }

  async completeText(request: TextCompletionRequest): Promise<TextCompletionResult> {
    try {
      const result = await this.options.inner.completeText(request);
      await this.recordUsage(result.inputTokens, result.outputTokens);
      return result;
    } catch (error) {
      const reason = this.logProviderFailure(error);
      if (this.options.failClosed) {
        throw error;
      }
      const fallbackResult = await this.options.fallback.completeText(request);
      return { ...fallbackResult, isFallback: true, fallbackReason: reason };
    }
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    try {
      const result = await this.options.inner.completeJson(request);
      await this.recordUsage(result.inputTokens, result.outputTokens);
      return result;
    } catch (error) {
      const reason = this.logProviderFailure(error);
      if (this.options.failClosed) {
        throw error;
      }
      const fallbackResult = await this.options.fallback.completeJson(request);
      return { ...fallbackResult, isFallback: true, fallbackReason: reason };
    }
  }

  private logProviderFailure(error: unknown): string {
    const reason = this.options.describeError?.(error) ?? "unknown";
    this.options.logger.warn(
      {
        provider: this.options.providerName,
        reason,
        error: error instanceof Error ? error.message : String(error),
      },
      this.options.failClosed
        ? `${this.options.providerName}: LLM call failed — failing closed for durable retry`
        : `${this.options.providerName}: LLM call failed — falling back to No-LLM mode`,
    );
    return reason;
  }

  private async recordUsage(inputTokens: number, outputTokens: number): Promise<void> {
    if (!this.options.usageSink) {
      return;
    }
    const model = this.options.inner.modelLabel ?? "unknown";
    const costUsd = this.options.estimateCostUsd?.(model, inputTokens, outputTokens) ?? 0;
    try {
      await this.options.usageSink.insert({
        provider: this.options.providerName,
        model,
        inputTokens,
        outputTokens,
        costUsd,
      });
    } catch (error) {
      this.options.logger.error(
        {
          provider: this.options.providerName,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to record LLM usage",
      );
    }
  }
}
