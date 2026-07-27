import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../lib/env";
import { backfillMislabeledAiGenerated } from "../../../../lib/pipeline";
import { getLogger } from "../../../../lib/logger";

/**
 * One-off operational endpoint (Content Quality & Reliability Hardening
 * sprint): idempotently corrects `StoryVersion` rows mislabeled as No-LLM
 * purely because the self-check step's own call fell back, even though the
 * generation call itself was real (see `lib/pipeline.ts`
 * `backfillMislabeledAiGenerated` for the exact detection rule). Never
 * rewrites title/lead/body, never deletes anything — label columns only.
 *
 * Auth: same `Bearer CRON_SECRET` convention as `/api/internal/reprocess-no-llm`.
 */
export const maxDuration = 30;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await backfillMislabeledAiGenerated();
    return NextResponse.json(result);
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error) },
      "backfill-ai-labels failed",
    );
    return NextResponse.json({ error: "backfill failed" }, { status: 500 });
  }
}
