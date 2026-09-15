interface CloudflareEnv {
  SITE_URL: string;
  LLM_PROVIDER: "cloudflare";
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_AI_MODEL: string;
  WORKERS_AI_API_TOKEN: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  GEMINI_FREE_ONLY: "true" | "false";
  GEMINI_DAILY_REQUEST_CAP: string;
  GEMINI_MONTHLY_BUDGET_USD: string;
  GEMINI_BASE_URL: string;
  CLOUDFLARE_AI_GATEWAY_TOKEN: string;
  FORCE_REVIEW_MODE: "true" | "false";
  HYPERDRIVE?: {
    connectionString: string;
  };
}
