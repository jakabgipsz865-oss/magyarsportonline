import {
  CloudflareWorkersAiLlmClient,
  NoLlmClient,
  ProviderFallbackLlmClient,
  describeCloudflareError,
  estimateCloudflareCostUsd,
  type LlmClient,
} from "@magyarsportonline/llm";
import { createRepositories } from "./db";
import { env } from "./env";
import { getLogger } from "./logger";

let cachedClient: LlmClient | undefined;

/**
 * `LLM_PROVIDER=none` is an explicit local-development/test mode. Production
 * defaults to Cloudflare and must fail loudly if its credentials are missing.
 *
 * `LLM_PROVIDER=cloudflare` is the only production path. The wrapper records
 * usage but is deliberately fail-closed: quota, network, HTTP, JSON, and
 * schema failures are rethrown to the durable queue. It never creates a
 * schema-valid No-LLM article and never switches to another AI provider.
 */
export function getLlmClient(): LlmClient {
  if (cachedClient) {
    return cachedClient;
  }

  if (env.LLM_PROVIDER === "cloudflare") {
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
      throw new Error(
        "LLM_PROVIDER=cloudflare requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to be set (see docs/infrastructure-setup.md)",
      );
    }
    cachedClient = new ProviderFallbackLlmClient({
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
    cachedClient = new NoLlmClient();
  }

  return cachedClient;
}
