import {
  CloudflareApiError,
  CloudflareWorkersAiLlmClient,
  startOfCurrentMonthUtc,
  type JsonCompletionRequest,
} from "@magyarsportonline/llm";
import { createRepositories } from "./db";
import { env } from "./env";
import { getLlmClient } from "./llm";

/** Same shape as hungarian-writer/self-check.ts's SELF_CHECK_JSON_SCHEMA — reused here (not imported, to keep this diagnostic tool independent of that module) as a minimal, cheap, real production-matching call shape. */
const DIAGNOSTIC_REQUEST: JsonCompletionRequest = {
  model: env.CLOUDFLARE_AI_MODEL,
  system:
    'Válaszolj KIZÁRÓLAG ezzel a JSON-nal, más szöveg nélkül: {"consistent": true, "fact_consistency_score": 1, "issues": []}',
  messages: [{ role: "user", content: "diagnosztikai teszthívás" }],
  maxTokens: 64,
  jsonSchema: {
    type: "object",
    properties: {
      consistent: { type: "boolean" },
      fact_consistency_score: { type: "number" },
      issues: { type: "array", items: { type: "string" } },
    },
    required: ["consistent", "fact_consistency_score", "issues"],
    additionalProperties: false,
  },
};

interface RawCallOutcome {
  ok: boolean;
  inputTokens?: number;
  outputTokens?: number;
  errorName?: string;
  errorMessage?: string;
  cloudflareErrorKind?: string;
  httpStatus?: number;
}

async function tryRawCloudflareCall(): Promise<RawCallOutcome> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    return {
      ok: false,
      errorName: "ConfigError",
      errorMessage: "CLOUDFLARE_ACCOUNT_ID/API_TOKEN not set",
    };
  }
  const raw = new CloudflareWorkersAiLlmClient({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    model: env.CLOUDFLARE_AI_MODEL,
  });
  try {
    const result = await raw.completeJson(DIAGNOSTIC_REQUEST);
    return { ok: true, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  } catch (error) {
    if (error instanceof CloudflareApiError) {
      return {
        ok: false,
        errorName: error.name,
        errorMessage: error.message,
        cloudflareErrorKind: error.kind,
        httpStatus: error.status,
      };
    }
    return {
      ok: false,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Read-only diagnostic for "why did the Editorial A/B test's LLM calls all
 * fall back" (2026-07-28 incident): distinguishes an *actual* Cloudflare
 * call failure (bad token, model unavailable, network/service error —
 * `ProviderFallbackLlmClient`'s domain, triggered on ANY error) from the
 * *unrelated* monthly budget guard (`BudgetGuardedLlmClient`, which only
 * wraps `LLM_PROVIDER=anthropic` — never consulted at all when
 * `LLM_PROVIDER=cloudflare`, which is what's actually configured here).
 * Never writes to the database.
 */
export async function runLlmDiagnostics(): Promise<{
  config: {
    llmProvider: string;
    cloudflareModel: string;
    cloudflareAccountIdConfigured: boolean;
    cloudflareApiTokenConfigured: boolean;
    monthlyBudgetUsd: number;
    budgetGuardAppliesToThisProvider: boolean;
  };
  usage: {
    currentMonthCostUsd: number;
    recentCalls: Array<{
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: string;
      occurredAt: Date;
    }>;
  };
  rawCloudflareCall: RawCallOutcome;
  wrappedProductionClientCall: { isFallback: boolean; data?: unknown; errorMessage?: string };
}> {
  const repos = createRepositories();
  const now = new Date();

  const currentMonthCostUsd = await repos.llmUsageRepository.sumCostUsdSince(
    startOfCurrentMonthUtc(now),
  );
  const recentCalls = await repos.llmUsageRepository.listRecent(10);

  const rawCloudflareCall = await tryRawCloudflareCall();

  let wrappedProductionClientCall: { isFallback: boolean; data?: unknown; errorMessage?: string };
  try {
    const llm = getLlmClient();
    const result = await llm.completeJson(DIAGNOSTIC_REQUEST);
    wrappedProductionClientCall = { isFallback: result.isFallback ?? false, data: result.data };
  } catch (error) {
    wrappedProductionClientCall = {
      isFallback: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    config: {
      llmProvider: env.LLM_PROVIDER,
      cloudflareModel: env.CLOUDFLARE_AI_MODEL,
      cloudflareAccountIdConfigured: Boolean(env.CLOUDFLARE_ACCOUNT_ID),
      cloudflareApiTokenConfigured: Boolean(env.CLOUDFLARE_API_TOKEN),
      monthlyBudgetUsd: env.LLM_MONTHLY_BUDGET_USD,
      // BudgetGuardedLlmClient is only constructed for LLM_PROVIDER=anthropic
      // (apps/web/lib/llm.ts getLlmClient) — cloudflare/gemini use
      // ProviderFallbackLlmClient instead, which has no budget concept at all.
      budgetGuardAppliesToThisProvider: env.LLM_PROVIDER === "anthropic",
    },
    usage: {
      currentMonthCostUsd,
      recentCalls: recentCalls.map((row) => ({
        provider: row.provider,
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        costUsd: row.costUsd,
        occurredAt: row.occurredAt,
      })),
    },
    rawCloudflareCall,
    wrappedProductionClientCall,
  };
}
