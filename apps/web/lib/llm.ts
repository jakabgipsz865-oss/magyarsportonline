import {
  CloudflareWorkersAiLlmClient,
  ConditionalFallbackLlmClient,
  DailyRequestCappedLlmClient,
  GeminiLlmClient,
  NoLlmClient,
  ProviderFallbackLlmClient,
  WRITER_CLOUDFLARE_MODEL,
  describeCloudflareError,
  describeGeminiError,
  estimateCloudflareCostUsd,
  isGeminiDefinitelyUnmeteredError,
  isDailyLlmQuotaError,
  isGeminiDailyQuotaError,
  type LlmClient,
} from "@magyarsportonline/llm";
import { createRepositories } from "./db";
import { env } from "./env";
import { getLogger } from "./logger";

let cachedFactClient: LlmClient | undefined;
let cachedWriterClient: LlmClient | undefined;

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

export function getWriterLlmClient(): LlmClient {
  if (cachedWriterClient) return cachedWriterClient;
  if (env.LLM_PROVIDER === "none") return (cachedWriterClient = new NoLlmClient());
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
          model: env.GEMINI_MODEL,
          unifiedBilling: {
            accountId: env.CLOUDFLARE_ACCOUNT_ID!,
            apiToken: env.WORKERS_AI_API_TOKEN!,
            gatewayId: env.CLOUDFLARE_AI_GATEWAY_ID,
          },
        })
      : new GeminiLlmClient({
          apiKey: geminiApiKey!,
          model: env.GEMINI_MODEL,
          baseUrl: env.GEMINI_BASE_URL!,
          gatewayToken: env.CLOUDFLARE_AI_GATEWAY_TOKEN!,
        });
  const repos = createRepositories();
  const metered = new ProviderFallbackLlmClient({
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
    metered,
    "gemini",
    env.GEMINI_DAILY_REQUEST_CAP,
    repos.llmUsageRepository,
    isGeminiDefinitelyUnmeteredError,
  );
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.WORKERS_AI_API_TOKEN) {
    cachedWriterClient = cappedGemini;
    return cachedWriterClient;
  }
  const cloudflare = new ProviderFallbackLlmClient({
    inner: new CloudflareWorkersAiLlmClient({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.WORKERS_AI_API_TOKEN,
      model: WRITER_CLOUDFLARE_MODEL,
    }),
    fallback: new NoLlmClient(),
    providerName: "cloudflare",
    usageSink: repos.llmUsageRepository,
    estimateCostUsd: estimateCloudflareCostUsd,
    describeError: describeCloudflareError,
    logger: getLogger(),
    failClosed: true,
  });
  cachedWriterClient = new ConditionalFallbackLlmClient(
    cappedGemini,
    cloudflare,
    (error) => isDailyLlmQuotaError(error) || isGeminiDailyQuotaError(error),
  );
  return cachedWriterClient;
}

/** Compatibility alias for diagnostics that probe the Fact provider. */
export const getLlmClient = getFactLlmClient;
