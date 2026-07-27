import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../lib/env";
import { getLogger } from "../../../../lib/logger";
import { reprocessNoLlmStories } from "../../../../lib/pipeline";

/**
 * One-off operational endpoint (docs/architecture/04-api-spec.md §4.3 mintája):
 * re-runs Hungarian Writer → SEO → Publish Gate for every Story whose latest
 * version is still the No-LLM passthrough — a real LLM provider becoming
 * available *after* articles were already ingested (e.g. a misconfigured
 * `CLOUDFLARE_API_TOKEN` getting fixed) doesn't retroactively rewrite them on
 * its own, since ingest dedupes by `RawArticle.sourceUrl` and never re-fires
 * `source/article.ingested` for a URL it has already seen. Safe/additive:
 * every re-write is a brand-new `StoryVersion`, never an overwrite.
 *
 * Auth: same `Bearer CRON_SECRET` convention as `/api/internal/setup` and
 * `/api/internal/cron/dispatch-ingest` — never publicly callable.
 *
 * maxDuration = 60: the Vercel Hobby-plan maximum — real writer/self-check
 * calls per story are genuine sequential network round-trips, hence also
 * capping how many stories `reprocessNoLlmStories` reprocesses per call.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await reprocessNoLlmStories();
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
