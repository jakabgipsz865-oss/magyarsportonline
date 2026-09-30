import {
  CloudflareWorkersAiLlmClient,
  DailyRequestCappedLlmClient,
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
import { createLlmUsageRepository, d1Binding } from "./db";
import { env } from "./env";
import { getLogger } from "./logger";

let cachedFactClient: LlmClient | undefined;
let cachedWriterClient: LlmClient | undefined;
let cachedRepairClient: LlmClient | undefined;

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
    if (d1Binding() && env.GEMINI_MONTHLY_EXTERNAL_SPEND_USD === undefined)
      throw new Error(
        "D1 paid AI requires verified current-UTC-month GEMINI_MONTHLY_EXTERNAL_SPEND_USD (0 if none)",
      );
    const factClient = new ProviderFallbackLlmClient({
      inner: new CloudflareWorkersAiLlmClient({
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: env.WORKERS_AI_API_TOKEN,
        model: env.CLOUDFLARE_AI_MODEL,
      }),
      fallback: new NoLlmClient(),
      providerName: "cloudflare",
      describeError: describeCloudflareError,
      logger: getLogger(),
      failClosed: true,
    });
    cachedFactClient = new DailyRequestCappedLlmClient(
      factClient,
      "cloudflare",
      env.GEMINI_DAILY_REQUEST_CAP,
      createLlmUsageRepository(),
      () => false,
      estimateCloudflareCostUsd,
      {
        capUsd: env.GEMINI_MONTHLY_BUDGET_USD,
        externalSpentUsd: env.GEMINI_MONTHLY_EXTERNAL_SPEND_USD ?? 0,
        externalSpentMonth: env.GEMINI_MONTHLY_EXTERNAL_SPEND_MONTH,
      },
    );
  } else {
    cachedFactClient = new NoLlmClient();
  }

  return cachedFactClient;
}

function createGeminiWriter(model: string): LlmClient {
  if (env.LLM_PROVIDER === "none") return new NoLlmClient();
  if (d1Binding() && env.GEMINI_MONTHLY_EXTERNAL_SPEND_USD === undefined)
    throw new Error(
      "D1 paid AI requires verified current-UTC-month GEMINI_MONTHLY_EXTERNAL_SPEND_USD (0 if none)",
    );
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
  const usage = createLlmUsageRepository();
  const failClosed = new ProviderFallbackLlmClient({
    inner: geminiClient,
    fallback: new NoLlmClient(),
    providerName: "gemini",
    describeError: describeGeminiError,
    logger: getLogger(),
    failClosed: true,
  });
  // Both Gemini roles and Workers AI Fact reserve against the same D1 ledger.
  const cappedGemini = new DailyRequestCappedLlmClient(
    failClosed,
    "gemini",
    env.GEMINI_DAILY_REQUEST_CAP,
    usage,
    isGeminiDefinitelyUnmeteredError,
    estimateGeminiCostUsd,
    {
      capUsd: env.GEMINI_MONTHLY_BUDGET_USD,
      externalSpentUsd: env.GEMINI_MONTHLY_EXTERNAL_SPEND_USD ?? 0,
      externalSpentMonth: env.GEMINI_MONTHLY_EXTERNAL_SPEND_MONTH,
    },
  );
  return cappedGemini;
}

export function getWriterLlmClient(): LlmClient {
  return (cachedWriterClient ??= createGeminiWriter(env.GEMINI_MODEL));
}

/** Gemini Flash is reserved for one targeted repair of a persisted draft. */
export function getWriterRepairLlmClient(): LlmClient {
  return (cachedRepairClient ??= createGeminiWriter("gemini-3.5-flash"));
}

/** Compatibility alias for diagnostics that probe the Fact provider. */
export const getLlmClient = getFactLlmClient;
