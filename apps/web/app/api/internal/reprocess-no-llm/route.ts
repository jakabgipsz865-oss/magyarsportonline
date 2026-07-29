import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../lib/env";
import { getLogger } from "../../../../lib/logger";
import { reprocessNoLlmStories } from "../../../../lib/pipeline";

/**
 * Authenticated enqueue endpoint for complete, asynchronous Story
 * regeneration. It does no LLM work in this request; the durable worker
 * executes every pipeline stage with retry/backoff.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "30");
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(50, Math.max(1, Math.floor(requestedLimit)))
      : 30;
    const includePublished = request.nextUrl.searchParams.get("includePublished") === "true";
    const forceRegeneration = request.nextUrl.searchParams.get("forceRegeneration") === "true";
    const result = await reprocessNoLlmStories({
      limit,
      includePublished,
      forceRegeneration,
    });
    return NextResponse.json({
      reprocessedCount: result.reprocessedStoryIds.length,
      reprocessedStoryIds: result.reprocessedStoryIds,
    });
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error) },
      "reprocess-no-llm failed",
    );
    return NextResponse.json({ error: "reprocess failed" }, { status: 500 });
  }
}
