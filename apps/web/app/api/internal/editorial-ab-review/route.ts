import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../lib/env";
import { getLogger } from "../../../../lib/logger";
import { runEditorialAbReviewBatch } from "../../../../lib/pipeline";

/**
 * Same batched A/B comparison as `/api/internal/editorial-ab-test`, plus
 * persistence into `editorial_ab_snapshots` for the human-reviewable
 * `/internal/editorial-ab-review` admin page (2026-07-28 sprint). The
 * GitHub Actions workflow (.github/workflows/editorial-ab-test.yml) calls
 * this endpoint instead of the older read-only one so every run's results
 * stay browsable afterwards, not just visible in the workflow's own log.
 *
 * Auth: same `Bearer CRON_SECRET` convention as `/api/internal/editorial-ab-test`
 * — this is still an automation-triggered endpoint, not the human-facing
 * page (that's gated separately by `ADMIN_SECRET` via middleware.ts).
 */
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "5");
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 10
  ) {
    return NextResponse.json({ error: "invalid offset/limit" }, { status: 400 });
  }

  try {
    const { results, errors, totalCandidates, nextOffset } = await runEditorialAbReviewBatch({
      offset,
      limit,
    });
    return NextResponse.json({ results, errors, totalCandidates, nextOffset });
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error) },
      "editorial-ab-review failed",
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "editorial-ab-review failed" },
      { status: 500 },
    );
  }
}
