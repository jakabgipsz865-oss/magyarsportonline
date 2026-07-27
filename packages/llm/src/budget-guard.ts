import type {
  JsonCompletionRequest,
  JsonCompletionResult,
  LlmClient,
  TextCompletionRequest,
  TextCompletionResult,
} from "./client";
import { estimateCostUsd } from "./pricing";

/**
 * A tárgyhónapban felhalmozott költség lekérdezése + új hívás rögzítése —
 * production-ben a @magyarsportonline/db LlmUsageRepository adja, tesztben
 * in-memory fake.
 */
export interface LlmUsageStore {
  sumCostUsdSince(since: Date): Promise<number>;
  insert(entry: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): Promise<unknown>;
}

/** Minimális logger-felület, hogy a csomag ne függjön az observability csomagtól. */
export interface BudgetGuardLogger {
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface BudgetGuardOptions {
  /** A valódi (fizetős) kliens. */
  inner: LlmClient;
  /** A plafon felett ide esünk vissza (jellemzően NoLlmClient) — a rendszer nem áll le. */
  fallback: LlmClient;
  usageStore: LlmUsageStore;
  monthlyBudgetUsd: number;
  logger: BudgetGuardLogger;
  /** Tesztelhetőség: injektálható óra. */
  now?: () => Date;
}

/** UTC hónapkezdet — a havi plafon elszámolási időszakának kezdete. */
export function startOfCurrentMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Költségplafon-őr LlmClient dekorátor: minden hívás előtt a tárgyhónap
 * eddigi költését ellenőrzi. A plafon elérésekor a fallback klienshez
 * irányít (No-LLM mód), nem hibázik és nem áll le — a pipeline minden más
 * lépése változatlanul fut. A budget-ellenőrzés hibája (pl. DB-hiba) is a
 * fallback felé terel: költés szempontjából fail-closed viselkedés.
 */
export class BudgetGuardedLlmClient implements LlmClient {
  constructor(private readonly options: BudgetGuardOptions) {}

  async completeText(request: TextCompletionRequest): Promise<TextCompletionResult> {
    if (await this.isOverBudget()) {
      return this.options.fallback.completeText(request);
    }
    const result = await this.options.inner.completeText(request);
    await this.recordUsage(request.model, result.inputTokens, result.outputTokens);
    return result;
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    if (await this.isOverBudget()) {
      return this.options.fallback.completeJson(request);
    }
    const result = await this.options.inner.completeJson(request);
    await this.recordUsage(request.model, result.inputTokens, result.outputTokens);
    return result;
  }

  private async isOverBudget(): Promise<boolean> {
    const now = this.options.now?.() ?? new Date();
    let spentUsd: number;
    try {
      spentUsd = await this.options.usageStore.sumCostUsdSince(startOfCurrentMonthUtc(now));
    } catch (error) {
      this.options.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LLM budget check failed — falling back to No-LLM mode (fail-closed)",
      );
      return true;
    }
    if (spentUsd >= this.options.monthlyBudgetUsd) {
      this.options.logger.warn(
        { spentUsd, monthlyBudgetUsd: this.options.monthlyBudgetUsd },
        "Monthly LLM budget reached — serving request via No-LLM fallback",
      );
      return true;
    }
    return false;
  }

  private async recordUsage(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    const costUsd = estimateCostUsd(model, inputTokens, outputTokens);
    try {
      await this.options.usageStore.insert({ model, inputTokens, outputTokens, costUsd });
    } catch (error) {
      // A már kifizetett hívás eredményét nem dobjuk el egy naplózási hiba
      // miatt — de hangosan jelezzük, mert a plafon pontossága múlik rajta.
      this.options.logger.error(
        { error: error instanceof Error ? error.message : String(error), model, costUsd },
        "Failed to record LLM usage — monthly budget accounting may undercount",
      );
    }
  }
}
