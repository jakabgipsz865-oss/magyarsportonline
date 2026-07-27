import Anthropic from "@anthropic-ai/sdk";
import { estimateCostUsd } from "./models.js";

export interface LlmCompletionResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** `null` when the model isn't in the (approximate) pricing table — see models.ts. */
  costUsd: number | null;
}

export interface LlmCompletionParams {
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
}

export interface LlmClient {
  complete(params: LlmCompletionParams): Promise<LlmCompletionResult>;
}

/** `true` iff a real Anthropic call can be made — used by callers to pick the LLM vs. fallback code path (ADR 0007). */
export function isLlmConfigured(apiKey: string | undefined): apiKey is string {
  return typeof apiKey === "string" && apiKey.length > 0;
}

class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(params: LlmCompletionParams): Promise<LlmCompletionResult> {
    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens ?? 1024,
      system: params.system,
      messages: [{ role: "user", content: params.prompt }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      model: params.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd: estimateCostUsd(
        params.model,
        response.usage.input_tokens,
        response.usage.output_tokens,
      ),
    };
  }
}

export function createAnthropicClient(apiKey: string): LlmClient {
  return new AnthropicLlmClient(apiKey);
}
