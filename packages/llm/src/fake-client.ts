import type {
  JsonCompletionRequest,
  JsonCompletionResult,
  LlmClient,
  TextCompletionRequest,
  TextCompletionResult,
} from "./client";

/**
 * Deterministic test double for `LlmClient` (see docs/architecture/09-architecture-review.md
 * §4 — narrow, injectable dependencies per agent). Agents depend on the
 * `LlmClient` interface, never on `AnthropicLlmClient` directly, so their
 * unit tests can queue canned responses here instead of calling the real API
 * — which this development environment has no credentials for.
 */
export class FakeLlmClient implements LlmClient {
  private textResponses: TextCompletionResult[] = [];
  private jsonResponses: JsonCompletionResult[] = [];
  readonly textRequests: TextCompletionRequest[] = [];
  readonly jsonRequests: JsonCompletionRequest[] = [];

  queueText(result: TextCompletionResult): void {
    this.textResponses.push(result);
  }

  queueJson(result: JsonCompletionResult): void {
    this.jsonResponses.push(result);
  }

  async completeText(request: TextCompletionRequest): Promise<TextCompletionResult> {
    this.textRequests.push(request);
    const next = this.textResponses.shift();
    if (!next) {
      throw new Error("FakeLlmClient.completeText called with no queued response");
    }
    return next;
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    this.jsonRequests.push(request);
    const next = this.jsonResponses.shift();
    if (!next) {
      throw new Error("FakeLlmClient.completeJson called with no queued response");
    }
    return next;
  }
}
