import {
  CloudflareWorkersAiLlmClient,
  DailyRequestCappedLlmClient,
  DailyLlmRequestCapError,
  GeminiLlmClient,
  NoLlmClient,
  ProviderFallbackLlmClient,
  describeCloudflareError,
  describeGeminiError,
  estimateCloudflareCostUsd,
  estimateGeminiCostUsd,
  isGeminiDefinitelyUnmeteredError,
  type LlmClient,
} from "@magyarsportonline/llm";
import { createRepositories } from "./db";
import { env } from "./env";
import { getLogger } from "./logger";

let cachedFactClient: LlmClient | undefined;
let cachedWriterClient: LlmClient | undefined;
let cachedRepairClient: LlmClient | undefined;

class MonthlyBudgetCappedLlmClient implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly monthlyBudgetUsd: number,
    private readonly usage: ReturnType<typeof createRepositories>["llmUsageRepository"],
  ) {}
  get modelLabel() {
    return this.inner.modelLabel;
  }
  private async assertBudget() {
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    if ((await this.usage.sumCostUsdSince(since)) >= this.monthlyBudgetUsd)
      throw new DailyLlmRequestCapError("gemini-monthly-budget", 0);
  }
  async completeText(request: Parameters<LlmClient["completeText"]>[0]) {
    await this.assertBudget();
    return this.inner.completeText(request);
  }
  async completeJson(request: Parameters<LlmClient["completeJson"]>[0]) {
    await this.assertBudget();
    return this.inner.completeJson(request);
  }
}

/**
 * `LLM_PROVIDER=none` is an explicit local-development/test mode. Production
 * defaults to Cloudflare and must fail loudly if its credentials are missing.
 *
 * `LLM_PROVIDER=cloudflare` is the production Fact path. The wrapper records
 * usage and fails closed on provider or schema errors.
 */
export function getFactLlmClient(): LlmClient {
  if (cachedFactClient) {
    return cachedFactClient;
  }

  if (env.LLM_PROVIDER === "cloudflare") {
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.WORKERS_AI_API_TOKEN) {
      throw new Error(
        "LLM_PROVIDER=cloudflare requires CLOUDFLARE_ACCOUNT_ID and WORKERS_AI_API_TOKEN to be set (see docs/infrastructure-setup.md)",
      );
    }
    cachedFactClient = new ProviderFallbackLlmClient({
      inner: new CloudflareWorkersAiLlmClient({
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: env.WORKERS_AI_API_TOKEN,
        model: env.CLOUDFLARE_AI_MODEL,
      }),
      fallback: new NoLlmClient(),
      providerName: "cloudflare",
      usageSink: createRepositories().llmUsageRepository,
      estimateCostUsd: estimateCloudflareCostUsd,
      describeError: describeCloudflareError,
      logger: getLogger(),
      failClosed: true,
    });
  } else {
    cachedFactClient = new NoLlmClient();
  }

  return cachedFactClient;
}

function createGeminiWriter(model: string): LlmClient {
  if (env.LLM_PROVIDER === "none") return new NoLlmClient();
  const geminiApiKey = env.GEMINI_BILLING_MODE === "byok" ? env.GEMINI_API_KEY : undefined;
  if (
    env.GEMINI_BILLING_MODE === "byok" &&
    (!geminiApiKey || !env.CLOUDFLARE_AI_GATEWAY_TOKEN || !env.GEMINI_BASE_URL)
  ) {
    throw new Error("Gemini BYOK billing requires Google and Cloudflare Gateway credentials");
  }
  if (
    env.GEMINI_BILLING_MODE === "unified" &&
    (!env.CLOUDFLARE_ACCOUNT_ID || !env.WORKERS_AI_API_TOKEN)
  ) {
    throw new Error("Gemini Unified Billing requires Cloudflare account credentials");
  }
  const geminiClient =
    env.GEMINI_BILLING_MODE === "unified"
      ? new GeminiLlmClient({
          model,
          unifiedBilling: {
            accountId: env.CLOUDFLARE_ACCOUNT_ID!,
            apiToken: env.WORKERS_AI_API_TOKEN!,
            gatewayId: env.CLOUDFLARE_AI_GATEWAY_ID,
          },
        })
      : new GeminiLlmClient({
          apiKey: geminiApiKey!,
          model,
          baseUrl: env.GEMINI_BASE_URL!,
          gatewayToken: env.CLOUDFLARE_AI_GATEWAY_TOKEN!,
        });
  const repos = createRepositories();
  const failClosed = new ProviderFallbackLlmClient({
    inner: geminiClient,
    fallback: new NoLlmClient(),
    providerName: "gemini",
    describeError: describeGeminiError,
    logger: getLogger(),
    failClosed: true,
  });
  // Gemini is routed through Cloudflare AI Gateway, where a provider-scoped
  // monthly spend limit enforces the paid budget. Keep this daily cap as a
  // second, application-side guard against runaway request volume.
  const cappedGemini = new DailyRequestCappedLlmClient(
    failClosed,
    "gemini",
    env.GEMINI_DAILY_REQUEST_CAP,
    repos.llmUsageRepository,
    isGeminiDefinitelyUnmeteredError,
    estimateGeminiCostUsd,
  );
  return new MonthlyBudgetCappedLlmClient(
    cappedGemini,
    env.GEMINI_MONTHLY_BUDGET_USD,
    repos.llmUsageRepository,
  );
}

export function getWriterLlmClient(): LlmClient {
  return (cachedWriterClient ??= createGeminiWriter(env.GEMINI_MODEL));
}

/** Gemini Flash is shared by the one targeted repair and technical fallback roles. */
export function getWriterRepairLlmClient(): LlmClient {
  return (cachedRepairClient ??= createGeminiWriter("gemini-3.5-flash"));
}

/** Compatibility alias for diagnostics that probe the Fact provider. */
export const getLlmClient = getFactLlmClient;
