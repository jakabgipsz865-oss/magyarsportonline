import { tabloid } from "@magyarsportonline/agents";
import type { LlmClient } from "@magyarsportonline/llm";
import { d1Binding } from "./db";
import { env } from "./env";

/** An explicit, fail-closed fake for the isolated remote D1 rehearsal. */
export function getD1StagingWriter(): LlmClient | null {
  if (!env.D1_TEST_WRITER_OUTPUT) return null;
  const hostname = new URL(env.SITE_URL).hostname;
  const sourceHostname = env.D1_TEST_SOURCE_ORIGIN
    ? new URL(env.D1_TEST_SOURCE_ORIGIN).hostname : null;
  if (!d1Binding() || !hostname.endsWith(".workers.dev") ||
      !sourceHostname?.endsWith(".workers.dev") ||
      env.LLM_PROVIDER !== "none" || env.FACEBOOK_AUTO_PUBLISH || env.DATABASE_URL) {
    throw new Error("D1 mock Writer is only allowed in a D1-only workers.dev staging runtime");
  }
  const output = tabloid.tabloidOutputSchema.parse(JSON.parse(env.D1_TEST_WRITER_OUTPUT));
  return {
    modelLabel: "mock-d1-staging-writer",
    async completeText() { throw new Error("D1 mock Writer does not support text completion"); },
    async completeJson() {
      return { data: output, inputTokens: 0, outputTokens: 0,
        modelLabel: "mock-d1-staging-writer" };
    },
  };
}
