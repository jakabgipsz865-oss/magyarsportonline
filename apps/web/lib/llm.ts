import { AnthropicLlmClient, NoLlmClient, type LlmClient } from "@magyarsportonline/llm";
import { env } from "./env";

let cachedClient: LlmClient | undefined;

/**
 * `LLM_PROVIDER=none` (default) returns the deterministic `NoLlmClient` —
 * no network call, no cost, no API key needed. `LLM_PROVIDER=anthropic`
 * switches to the real Anthropic API — the only other thing this function
 * enforces is that `ANTHROPIC_API_KEY` is actually set in that case, since
 * `env.ts` can't express "required only when X" declaratively.
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
    cachedClient = new AnthropicLlmClient(env.ANTHROPIC_API_KEY);
  } else {
    cachedClient = new NoLlmClient();
  }

  return cachedClient;
}
