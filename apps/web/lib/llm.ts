import { AnthropicLlmClient, type LlmClient } from "@magyarsportonline/llm";
import { env } from "./env";

let cachedClient: LlmClient | undefined;

export function getLlmClient(): LlmClient {
  cachedClient ??= new AnthropicLlmClient(env.ANTHROPIC_API_KEY);
  return cachedClient;
}
