import { createHash } from "node:crypto";
import {
  CloudflareApiError,
  CloudflareWorkersAiLlmClient,
  startOfCurrentMonthUtc,
  type JsonCompletionRequest,
} from "@magyarsportonline/llm";
import { createRepositories } from "./db";
import { env } from "./env";
import { getLlmClient } from "./llm";

/** Same shape as hungarian-writer/self-check.ts's SELF_CHECK_JSON_SCHEMA — reused here (not imported, to keep this diagnostic tool independent of that module) as a minimal, cheap, real production-matching call shape. */
const DIAGNOSTIC_REQUEST: JsonCompletionRequest = {
  model: env.CLOUDFLARE_AI_MODEL,
  system:
    'Válaszolj KIZÁRÓLAG ezzel a JSON-nal, más szöveg nélkül: {"consistent": true, "fact_consistency_score": 1, "issues": []}',
  messages: [{ role: "user", content: "diagnosztikai teszthívás" }],
  // 2048, mert a valódi self-check hívás (hungarian-writer/self-check.ts)
  // is ennyit használ (2026-07-28-tól, 1024-ről emelve) — a Qwen3 egy
  // reasoning modell, ami a rejtett gondolkodási tokenjeit is a max_tokens
  // keretből fedezi, így egy túl szűk keret üres `content`-et eredményezhet
  // és JSON.parse hibát dob, ami a hitelesítéstől független, önmagában
  // okozott hamis negatív lenne ebben a diagnosztikában.
  maxTokens: 2048,
  jsonSchema: {
    type: "object",
    properties: {
      consistent: { type: "boolean" },
      fact_consistency_score: { type: "number" },
      issues: { type: "array", items: { type: "string" } },
    },
    required: ["consistent", "fact_consistency_score", "issues"],
    additionalProperties: false,
  },
};

/** First 8 chars only, rest masked — enough to visually confirm "is this the new account ID" without exposing the full credential in a log/response body. */
function maskAccountId(accountId: string | undefined): string | null {
  if (!accountId) return null;
  const prefix = accountId.slice(0, 8);
  const maskedLength = Math.max(accountId.length - 8, 0);
  return `${prefix}${"*".repeat(maskedLength)}`;
}

/**
 * First 8 hex chars of SHA-256(value) — lets a human compare "is the exact
 * string currently loaded in production byte-identical to the value I just
 * pasted into Vercel/Cloudflare" by computing the same hash locally, WITHOUT
 * this endpoint ever returning the actual secret. Not cryptographically
 * sensitive on its own (a truncated hash of a high-entropy token isn't
 * practically reversible), but still never logged/returned anywhere except
 * this one diagnostic field.
 */
function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
}

/** Copy-paste corruption that would silently break an otherwise-correct credential: surrounding whitespace, stray quote characters (common when a value gets copied straight out of a .env file or JSON), or embedded newlines/carriage returns. */
function detectCorruption(value: string): string[] {
  const issues: string[] = [];
  if (value !== value.trim()) issues.push("leading_or_trailing_whitespace");
  if (/["']/.test(value)) issues.push("contains_quote_character");
  if (/[\r\n]/.test(value)) issues.push("contains_newline_or_carriage_return");
  if (/\s/.test(value.trim())) issues.push("contains_internal_whitespace");
  return issues;
}

interface TokenVerifyOutcome {
  checked: boolean;
  httpStatus?: number;
  success?: boolean;
  tokenStatus?: string | null;
  errors?: Array<{ code?: number; message?: string }>;
  errorMessage?: string;
}

/**
 * Cloudflare's own token self-check (`GET /user/tokens/verify`) — works for
 * ANY valid API token regardless of what it's scoped to, so it isolates
 * "is this token well-formed, active, and not expired/revoked at all" from
 * "does it specifically have Workers AI permission for this account" (the
 * latter is what the existing `tryRawCloudflareCall` chat-completions call
 * tests). If this succeeds but the Workers AI call still 401s, the token
 * itself is valid Cloudflare-side and the problem is a missing permission/
 * wrong-account scope on it, not a corrupted/garbage string.
 */
async function verifyCloudflareToken(): Promise<TokenVerifyOutcome> {
  if (!env.CLOUDFLARE_API_TOKEN) {
    return { checked: false };
  }
  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
    });
    const body = (await response.json()) as {
      success?: boolean;
      result?: { status?: string };
      errors?: Array<{ code?: number; message?: string }>;
    };
    return {
      checked: true,
      httpStatus: response.status,
      success: body.success ?? false,
      tokenStatus: body.result?.status ?? null,
      errors: body.errors ?? [],
    };
  } catch (error) {
    return {
      checked: true,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

interface RawCallOutcome {
  ok: boolean;
  inputTokens?: number;
  outputTokens?: number;
  errorName?: string;
  errorMessage?: string;
  cloudflareErrorKind?: string;
  httpStatus?: number;
}

async function tryRawCloudflareCall(): Promise<RawCallOutcome> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    return {
      ok: false,
      errorName: "ConfigError",
      errorMessage: "CLOUDFLARE_ACCOUNT_ID/API_TOKEN not set",
    };
  }
  const raw = new CloudflareWorkersAiLlmClient({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    model: env.CLOUDFLARE_AI_MODEL,
  });
  try {
    const result = await raw.completeJson(DIAGNOSTIC_REQUEST);
    return { ok: true, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  } catch (error) {
    if (error instanceof CloudflareApiError) {
      return {
        ok: false,
        errorName: error.name,
        errorMessage: error.message,
        cloudflareErrorKind: error.kind,
        httpStatus: error.status,
      };
    }
    return {
      ok: false,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Read-only diagnostic for "why did the Editorial A/B test's LLM calls all
 * fall back" (2026-07-28 incident): distinguishes an *actual* Cloudflare
 * call failure (bad token, model unavailable, network/service error —
 * `ProviderFallbackLlmClient`'s domain, triggered on ANY error) from the
 * *unrelated* monthly budget guard (`BudgetGuardedLlmClient`, which only
 * wraps `LLM_PROVIDER=anthropic` — never consulted at all when
 * `LLM_PROVIDER=cloudflare`, which is what's actually configured here).
 * Never writes to the database.
 */
export async function runLlmDiagnostics(): Promise<{
  config: {
    llmProvider: string;
    /** Env-ben kért modell; egy nem JSON Mode-képes értéket az adapter fail-safe módon felülbírálhat. */
    cloudflareModel: string;
    /** A production kliens által ténylegesen használt modell. */
    effectiveCloudflareModel: string | null;
    /** First 8 chars, rest masked — see maskAccountId. Null when CLOUDFLARE_ACCOUNT_ID isn't set at all. */
    cloudflareAccountIdMasked: string | null;
    cloudflareAccountIdConfigured: boolean;
    cloudflareApiTokenConfigured: boolean;
    monthlyBudgetUsd: number;
    budgetGuardAppliesToThisProvider: boolean;
    /**
     * "production" | "preview" | "development" | null — Vercel injects
     * `VERCEL_ENV` automatically into every deployment (docs.vercel.com
     * runtime env vars), so this tells us which environment's variables
     * this specific running instance actually loaded — the concrete way to
     * settle "did the new Cloudflare credentials really reach Production,
     * or did they land in Preview/Development instead". Read directly from
     * `process.env` (not threaded through lib/env.ts's validated schema)
     * because it's a Vercel-provided introspection value, not app config —
     * a deliberate, narrow exception for this diagnostic only.
     */
    vercelEnv: string | null;
    /**
     * The unique ID of the deployment currently serving this request.
     * Vercel bakes this in at BUILD time, per deployment — it cannot go
     * stale/cached within a deployment's lifetime the way a runtime value
     * could, so two calls returning the same ID means they were served by
     * the literal same build artifact, not a caching artifact. Cross-check
     * it against the "Deployment" field on the Vercel dashboard's
     * Production Deployment card.
     */
    vercelDeploymentId: string | null;
    /** The git commit this specific deployment was built from — cross-check against the Vercel dashboard's "Source" field to confirm which commit is actually live. */
    vercelGitCommitSha: string | null;
  };
  usage: {
    currentMonthCostUsd: number;
    recentCalls: Array<{
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: string;
      occurredAt: Date;
    }>;
  };
  /**
   * Direct validation of the credential PAIR itself, independent of any
   * deployment-freshness question: a Cloudflare-side token self-check, a
   * SHA-256 fingerprint of each value (never the value itself) for offline
   * comparison, and copy-paste corruption detection (whitespace/quotes/
   * newlines) on both the account ID and the token as currently loaded in
   * this running process.
   */
  credentialValidation: {
    accountIdFingerprint: string | null;
    accountIdCorruption: string[];
    apiTokenFingerprint: string | null;
    apiTokenCorruption: string[];
    cloudflareTokenVerify: TokenVerifyOutcome;
  };
  rawCloudflareCall: RawCallOutcome;
  wrappedProductionClientCall: { isFallback: boolean; data?: unknown; errorMessage?: string };
}> {
  const repos = createRepositories();
  const now = new Date();

  const currentMonthCostUsd = await repos.llmUsageRepository.sumCostUsdSince(
    startOfCurrentMonthUtc(now),
  );
  const recentCalls = await repos.llmUsageRepository.listRecent(10);

  const rawCloudflareCall = await tryRawCloudflareCall();
  const cloudflareTokenVerify = await verifyCloudflareToken();

  let effectiveCloudflareModel: string | null = null;
  let wrappedProductionClientCall: { isFallback: boolean; data?: unknown; errorMessage?: string };
  try {
    const llm = getLlmClient();
    effectiveCloudflareModel = llm.modelLabel ?? null;
    const result = await llm.completeJson(DIAGNOSTIC_REQUEST);
    wrappedProductionClientCall = { isFallback: result.isFallback ?? false, data: result.data };
  } catch (error) {
    wrappedProductionClientCall = {
      isFallback: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    config: {
      llmProvider: env.LLM_PROVIDER,
      cloudflareModel: env.CLOUDFLARE_AI_MODEL,
      effectiveCloudflareModel,
      cloudflareAccountIdMasked: maskAccountId(env.CLOUDFLARE_ACCOUNT_ID),
      cloudflareAccountIdConfigured: Boolean(env.CLOUDFLARE_ACCOUNT_ID),
      cloudflareApiTokenConfigured: Boolean(env.CLOUDFLARE_API_TOKEN),
      monthlyBudgetUsd: env.LLM_MONTHLY_BUDGET_USD,
      // BudgetGuardedLlmClient is only constructed for LLM_PROVIDER=anthropic
      // (apps/web/lib/llm.ts getLlmClient) — cloudflare/gemini use
      // ProviderFallbackLlmClient instead, which has no budget concept at all.
      budgetGuardAppliesToThisProvider: env.LLM_PROVIDER === "anthropic",
      vercelEnv: process.env["VERCEL_ENV"] ?? null,
      vercelDeploymentId: process.env["VERCEL_DEPLOYMENT_ID"] ?? null,
      vercelGitCommitSha: process.env["VERCEL_GIT_COMMIT_SHA"] ?? null,
    },
    usage: {
      currentMonthCostUsd,
      recentCalls: recentCalls.map((row) => ({
        provider: row.provider,
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        costUsd: row.costUsd,
        occurredAt: row.occurredAt,
      })),
    },
    credentialValidation: {
      accountIdFingerprint: env.CLOUDFLARE_ACCOUNT_ID
        ? fingerprint(env.CLOUDFLARE_ACCOUNT_ID)
        : null,
      accountIdCorruption: env.CLOUDFLARE_ACCOUNT_ID
        ? detectCorruption(env.CLOUDFLARE_ACCOUNT_ID)
        : [],
      apiTokenFingerprint: env.CLOUDFLARE_API_TOKEN ? fingerprint(env.CLOUDFLARE_API_TOKEN) : null,
      apiTokenCorruption: env.CLOUDFLARE_API_TOKEN
        ? detectCorruption(env.CLOUDFLARE_API_TOKEN)
        : [],
      cloudflareTokenVerify,
    },
    rawCloudflareCall,
    wrappedProductionClientCall,
  };
}
