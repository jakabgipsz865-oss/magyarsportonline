import {
  AnthropicLlmClient,
  BudgetGuardedLlmClient,
  NoLlmClient,
  type LlmClient,
} from "@magyarsportonline/llm";
import { createRepositories } from "./db";
import { env } from "./env";
import { getLogger } from "./logger";

let cachedClient: LlmClient | undefined;

/**
 * `LLM_PROVIDER=none` (default) returns the deterministic `NoLlmClient` —
 * no network call, no cost, no API key needed. `LLM_PROVIDER=anthropic`
 * switches to the real Anthropic API, wrapped in the Budget Guard: every
 * call is token/cost-metered into the `llm_usage` table, and once the
 * monthly spend reaches `LLM_MONTHLY_BUDGET_USD` the guard transparently
 * serves requests from the NoLlmClient instead of failing or stopping
 * (packages/llm/src/budget-guard.ts).
 */
export function getLlmClient(): LlmClient {
  if (cachedClient) {
    return cachedClient;
  }

  if (env.LLM_PROVIDER === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error(
        "LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set (see docs/infrastructure-setup.md)",
      );
    }
    cachedClient = new BudgetGuardedLlmClient({
      inner: new AnthropicLlmClient(env.ANTHROPIC_API_KEY),
      fallback: new NoLlmClient(),
      usageStore: createRepositories().llmUsageRepository,
      monthlyBudgetUsd: env.LLM_MONTHLY_BUDGET_USD,
      logger: getLogger(),
    });
  } else {
    cachedClient = new NoLlmClient();
  }

  return cachedClient;
}
