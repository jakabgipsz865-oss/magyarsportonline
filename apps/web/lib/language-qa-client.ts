import { languageQa } from "@magyarsportonline/agents";
import {
  CloudflareWorkersAiLlmClient,
  type LlmClient,
  type JsonCompletionRequest,
} from "@magyarsportonline/llm";
import { env } from "./env";
/** Preview-only canned responses; never falls through to an external provider. */
export function getLanguageQaClient(): LlmClient {
  if (!env.LANGUAGE_QA_ENABLED) throw new Error("Language QA disabled");
  if (env.LANGUAGE_QA_MOCK_MODE !== "false") {
    if (
      env.APP_ENV !== "preview" ||
      !new URL(env.SITE_URL).hostname.endsWith(".workers.dev") ||
      env.LLM_PROVIDER !== "none"
    )
      throw new Error("QA mocks require isolated Preview and LLM_PROVIDER=none");
    return {
      modelLabel: "preview-fixture",
      async completeText() {
        throw new Error("QA JSON only");
      },
      async completeJson(request: JsonCompletionRequest) {
        let data: unknown = { status: "PASS", issues: [] };
        if (env.LANGUAGE_QA_MOCK_MODE === "fixtures") {
          const sentences = (
            JSON.parse(request.messages[0]!.content) as { sentences: languageQa.QaSentence[] }
          ).sentences;
          const fixture: Record<
            string,
            [string, (typeof languageQa.QA_ISSUE_TYPES)[number], boolean]
          > = {
            "Bayern won the match.": ["A Bayern megnyerte a mérkőzést.", "FOREIGN_LANGUAGE", false],
            "A Bayern győzelmet hozott a mérkőzésen.": [
              "A Bayern győzött a mérkőzésen.",
              "UNNATURAL_HUNGARIAN",
              false,
            ],
            "Kane 2 gólt szerzett.": ["Kane 3 gólt szerzett.", "GRAMMAR", false],
            "Kane nyert a mérkőzésen.": ["Messi nyert a mérkőzésen.", "GRAMMAR", false],
            "A Bayern győzött a meccsen.": ["A Bayern győzött a meccsen.", "GRAMMAR", true],
          };
          const sentence = sentences.find((s) => fixture[s.text]);
          if (sentence) {
            const [replacement, type, risk] = fixture[sentence.text]!;
            data = {
              status: "REPAIR",
              issues: [
                {
                  sentence_id: sentence.sentence_id,
                  type,
                  confidence: 0.99,
                  original: sentence.text,
                  replacement,
                  meaning_change_risk: risk,
                },
              ],
            };
          }
        }
        return { data, inputTokens: 0, outputTokens: 0, modelLabel: "preview-fixture" };
      },
    };
  }
  if (env.LLM_PROVIDER !== "cloudflare" || !env.CLOUDFLARE_ACCOUNT_ID || !env.WORKERS_AI_API_TOKEN)
    throw new Error("Workers AI credentials unavailable");
  return new CloudflareWorkersAiLlmClient({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.WORKERS_AI_API_TOKEN,
    model: languageQa.LANGUAGE_QA_MODEL,
    requestTimeoutMs: 70_000,
  });
}
