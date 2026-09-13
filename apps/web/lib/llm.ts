import {
  CloudflareWorkersAiLlmClient,
  ConditionalFallbackLlmClient,
  DailyRequestCappedLlmClient,
  GeminiLlmClient,
  NoLlmClient,
  ProviderFallbackLlmClient,
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
  if (!env.GEMINI_API_KEY || !env.GEMINI_DAILY_REQUEST_CAP) {
    throw new Error("Gemini Writer credentials or daily request cap are missing");
  }
  const repos = createRepositories();
  const metered = new ProviderFallbackLlmClient({
    inner: new GeminiLlmClient({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
      ...(env.GEMINI_BASE_URL ? { baseUrl: env.GEMINI_BASE_URL } : {}),
      ...(env.CLOUDFLARE_AI_GATEWAY_TOKEN ? { gatewayToken: env.CLOUDFLARE_AI_GATEWAY_TOKEN } : {}),
    }),
    fallback: new NoLlmClient(),
    providerName: "gemini",
    describeError: describeGeminiError,
    logger: getLogger(),
    failClosed: true,
  });
  // Preserve Gemini's stronger Hungarian output while its free 20-request
  // allocation is available, then continue on the configured Workers AI
  // model. Both real providers fail closed on invalid output.
  const cappedGemini = new DailyRequestCappedLlmClient(
    metered,
    "gemini",
    Math.min(20, env.GEMINI_DAILY_REQUEST_CAP),
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
      model: env.CLOUDFLARE_AI_MODEL,
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
