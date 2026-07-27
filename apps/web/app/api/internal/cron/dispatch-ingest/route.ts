import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../../lib/env";
import { getLogger } from "../../../../../lib/logger";
import { runIngestPipeline } from "../../../../../lib/pipeline";

/**
 * Cron entry point (docs/architecture/04-api-spec.md §4.3,
 * docs/architecture/06-deployment.md §6.5: `/api/internal/cron/dispatch-ingest`).
 * Service-token auth via Vercel Cron's `Authorization: Bearer $CRON_SECRET`
 * convention — never session-based, never publicly callable.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const results = await runIngestPipeline();
    return NextResponse.json({ results });
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error) },
      "dispatch-ingest failed",
    );
    return NextResponse.json({ error: "ingest pipeline failed" }, { status: 500 });
  }
}
