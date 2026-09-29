interface CloudflareEnv {
  APP_ENV?: "production" | "preview" | "development";
  LANGUAGE_QA_ENABLED?: "true" | "false";
  LANGUAGE_QA_DAILY_CALL_CAP?: string;
  LANGUAGE_QA_DAILY_BUDGET_USD?: string;
  LANGUAGE_QA_MOCK_MODE?: "false" | "pass" | "fixtures";
  DRAFT_RECOVERY_ENABLED?: "true" | "false";
  DB?: import("@magyarsportonline/db/d1").D1Client;
  SITE_URL: string;
  LLM_PROVIDER: "cloudflare";
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_AI_MODEL: string;
  WORKERS_AI_API_TOKEN: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  GEMINI_BILLING_MODE: "byok" | "unified";
  GEMINI_FREE_ONLY: "true" | "false";
  GEMINI_DAILY_REQUEST_CAP: string;
  GEMINI_MONTHLY_BUDGET_USD: string;
  GEMINI_BASE_URL: string;
  CLOUDFLARE_AI_GATEWAY_ID: string;
  CLOUDFLARE_AI_GATEWAY_TOKEN: string;
  FORCE_REVIEW_MODE: "true" | "false";
  FACEBOOK_AUTO_PUBLISH?: "true" | "false";
  FACEBOOK_AUTO_PUBLISH_START_AT: string;
  META_GRAPH_API_VERSION: string;
  FACEBOOK_QUEUE?: {
    send(message: unknown): Promise<unknown>;
  };
  HYPERDRIVE?: {
    connectionString: string;
  };
}
