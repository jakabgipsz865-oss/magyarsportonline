import {
  CloudflareWorkersAiLlmClient,
  DailyRequestCappedLlmClient,
  GeminiLlmClient,
  NoLlmClient,
  ProviderFallbackLlmClient,
  describeCloudflareError,
  describeGeminiError,
  estimateCloudflareCostUsd,
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
 * `LLM_PROVIDER=cloudflare` is the only production path. The wrapper records
 * usage but is deliberately fail-closed: quota, network, HTTP, JSON, and
 * schema failures are rethrown to the durable queue. It never creates a
 * schema-valid No-LLM article and never switches to another AI provider.
 */
export function getFactLlmClient(): LlmClient {
  if (cachedFactClient) {
    return cachedFactClient;
  }

  if (env.LLM_PROVIDER === "cloudflare") {
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
      throw new Error(
        "LLM_PROVIDER=cloudflare requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to be set (see docs/infrastructure-setup.md)",
      );
    }
    cachedFactClient = new ProviderFallbackLlmClient({
      inner: new CloudflareWorkersAiLlmClient({
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: env.CLOUDFLARE_API_TOKEN,
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
    inner: new GeminiLlmClient({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
    fallback: new NoLlmClient(),
    providerName: "gemini",
    describeError: describeGeminiError,
    logger: getLogger(),
    failClosed: true,
  });
  cachedWriterClient = new DailyRequestCappedLlmClient(
    metered,
    "gemini",
    env.GEMINI_DAILY_REQUEST_CAP,
    repos.llmUsageRepository,
  );
  return cachedWriterClient;
}

/** Compatibility alias for diagnostics that probe the Fact provider. */
export const getLlmClient = getFactLlmClient;
