import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../lib/env";
import { runLlmDiagnostics } from "../../../../lib/llm-diagnostics";
import { getLogger } from "../../../../lib/logger";

/**
 * One-off diagnostic endpoint for "why did every Editorial A/B test call
 * fall back to No-LLM" (2026-07-28): reports the exact config/usage/error
 * evidence needed to tell a real Cloudflare Workers AI failure apart from
 * an (in this case, inapplicable — see lib/llm-diagnostics.ts) budget cap,
 * instead of guessing. Makes exactly two real LLM calls (one raw, one
 * through the actual production client) — never writes to the database
 * itself (the calls it makes may log their own usage row on success, same
 * as any real pipeline call would).
 *
 * Auth: same `Bearer CRON_SECRET` convention as the other internal endpoints.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const diagnostics = await runLlmDiagnostics();
    return NextResponse.json(diagnostics);
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error) },
      "llm-diagnostics failed",
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "llm-diagnostics failed" },
      { status: 500 },
    );
  }
}
