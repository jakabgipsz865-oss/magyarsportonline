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
  /** A valódi (jellemzően ingyenes tierű) kliens. */
  inner: LlmClient;
  /** Bármilyen hibára ide esünk vissza (jellemzően NoLlmClient) — a rendszer nem áll le. */
  fallback: LlmClient;
  providerName: string;
  logger: ProviderFallbackLogger;
  usageSink?: LlmUsageSink;
  /** Alapértelmezés: mindig 0 (ingyenes tier — nincs mért költség). */
  estimateCostUsd?: (model: string, inputTokens: number, outputTokens: number) => number;
  /** Csak a naplóüzenet tartalmához — nem befolyásolja, hogy történik-e fallback. */
  describeError?: (error: unknown) => string;
}

/**
 * Reaktív provider-fallback dekorátor: minden hívást megpróbál a valódi
 * (`inner`) klienssel, és BÁRMILYEN hibára (kvóta, 429, 403, szolgáltatás-
 * vagy hálózati hiba) átirányít a `fallback` kliensre — a pipeline emiatt
 * sosem áll le. Szándékosan tágabb hibakezelés, mint a
 * `BudgetGuardedLlmClient`-é (ami csak a proaktív költség-plafonra esik
 * vissza, a tényleges API-hívás hibáját nem nyeli el): itt a cél egy
 * ingyenes tier rutinszerű kvótakimerülésének/instabilitásának
 * transzparens, sosem-megálló lekezelése.
 */
export class ProviderFallbackLlmClient implements LlmClient {
  constructor(private readonly options: ProviderFallbackOptions) {}

  /** A ténylegesen válaszoló (vagy válaszra kísérletet tevő) modell neve — a fallback esetén is az `inner` modelljét jelzi, hogy a hívó (Hungarian Writer) tudja, melyik konfigurált modell felé próbálkozott a rendszer. */
  get modelLabel(): string | undefined {
    return this.options.inner.modelLabel;
  }

  async completeText(request: TextCompletionRequest): Promise<TextCompletionResult> {
    try {
      const result = await this.options.inner.completeText(request);
      await this.recordUsage(result.inputTokens, result.outputTokens);
      return result;
    } catch (error) {
      const reason = this.logFallback(error);
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
      const reason = this.logFallback(error);
      const fallbackResult = await this.options.fallback.completeJson(request);
      return { ...fallbackResult, isFallback: true, fallbackReason: reason };
    }
  }

  private logFallback(error: unknown): string {
    const reason = this.options.describeError?.(error) ?? "unknown";
    this.options.logger.warn(
      {
        provider: this.options.providerName,
        reason,
        error: error instanceof Error ? error.message : String(error),
      },
      `${this.options.providerName}: LLM call failed — falling back to No-LLM mode`,
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
