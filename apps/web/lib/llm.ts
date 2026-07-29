import {
  AnthropicLlmClient,
  BudgetGuardedLlmClient,
  CloudflareWorkersAiLlmClient,
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

let cachedClient: LlmClient | undefined;

/**
 * `LLM_PROVIDER=none` (default) returns the deterministic `NoLlmClient` —
 * no network call, no cost, no API key needed.
 *
 * `LLM_PROVIDER=cloudflare` (jelenlegi aktív teszt-provider, 2026-07) a
 * Cloudflare Workers AI ingyenes napi Neuron-kerettel elérhető API-ját
 * hívja, wrapped in the (reactive) Provider Fallback: bármilyen hiba —
 * 4xx/5xx, kvótatúllépés, hálózati hiba, érvénytelen JSON-kimenet, vagy a
 * kért séma hiányos mezői — hangosan naplózva a NoLlmClient-re irányít, a
 * pipeline emiatt sosem áll le (packages/llm/src/cloudflare-client.ts,
 * provider-fallback-client.ts). Se Cloudflare Paid plan, se billing nincs
 * bekapcsolva ehhez — a token kizárólag szerveroldalon kerül felhasználásra.
 *
 * `LLM_PROVIDER=gemini` switches to the free-tier Gemini API, ugyanezzel a
 * Provider Fallback mintával. Jelenleg nincs aktívan használva, de az
 * adapter megmarad opcionális útvonalként.
 *
 * `LLM_PROVIDER=anthropic` switches to the real Anthropic API, wrapped in
 * the Budget Guard: every call is token/cost-metered into the `llm_usage`
 * table, and once the monthly spend reaches `LLM_MONTHLY_BUDGET_USD` the
 * guard transparently serves requests from the NoLlmClient instead of
 * failing or stopping (packages/llm/src/budget-guard.ts). Fizetős, jelenleg
 * nincs aktívan használva.
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
    const usageSink = createRepositories().llmUsageRepository;
    const secondaryProvider = env.GEMINI_API_KEY
      ? new ProviderFallbackLlmClient({
          inner: new GeminiLlmClient({
            apiKey: env.GEMINI_API_KEY,
            model: env.GEMINI_MODEL,
          }),
          fallback: new NoLlmClient(),
          providerName: "gemini",
          usageSink,
          estimateCostUsd: () => 0,
          describeError: describeGeminiError,
          logger: getLogger(),
          failClosed: true,
        })
      : null;
    cachedClient = new ProviderFallbackLlmClient({
      inner: new CloudflareWorkersAiLlmClient({
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: env.CLOUDFLARE_API_TOKEN,
        model: env.CLOUDFLARE_AI_MODEL,
      }),
      fallback: secondaryProvider ?? new NoLlmClient(),
      providerName: "cloudflare",
      usageSink,
      estimateCostUsd: estimateCloudflareCostUsd,
      describeError: describeCloudflareError,
      logger: getLogger(),
      // Cloudflare napi neuron-kvótája esetén a már konfigurált Gemini
      // kulccsal valódi LLM-en folytatjuk. Ha nincs másodlagos provider,
      // továbbra is fail-closed retry történik, sosem No-LLM cikk.
      failClosed: secondaryProvider === null,
      fallbackMode: secondaryProvider ? "provider" : "no_llm",
    });
  } else if (env.LLM_PROVIDER === "anthropic") {
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
  } else if (env.LLM_PROVIDER === "gemini") {
    if (!env.GEMINI_API_KEY) {
      throw new Error(
        "LLM_PROVIDER=gemini requires GEMINI_API_KEY to be set (see docs/infrastructure-setup.md)",
      );
    }
    cachedClient = new ProviderFallbackLlmClient({
      inner: new GeminiLlmClient({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
      fallback: new NoLlmClient(),
      providerName: "gemini",
      usageSink: createRepositories().llmUsageRepository,
      estimateCostUsd: () => 0,
      describeError: describeGeminiError,
      logger: getLogger(),
      failClosed: true,
    });
  } else {
    cachedClient = new NoLlmClient();
  }

  return cachedClient;
}
