import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../lib/env";
import { getLogger } from "../../../../lib/logger";
import { runEditorialAbTestBatch } from "../../../../lib/pipeline";

/**
 * One-off operational endpoint for the editorial style sprint's 50-article
 * A/B test (docs/editorial-style-guide.md, packages/agents/src/editorial-rewrite/ab-test.ts):
 * runs the current pipeline's already-published content against a fresh
 * Editorial Rewrite Agent pass, in memory only — never writes to the
 * database. A GitHub Actions workflow (.github/workflows/editorial-ab-test.yml)
 * pages through this with `offset`/`limit` to assemble the full 50-article
 * report without exceeding Vercel Hobby's 60s `maxDuration`.
 *
 * Auth: same `Bearer CRON_SECRET` convention as `/api/internal/setup`.
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
    const { results, totalCandidates, nextOffset } = await runEditorialAbTestBatch({
      offset,
      limit,
    });
    return NextResponse.json({ results, totalCandidates, nextOffset });
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error) },
      "editorial-ab-test failed",
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "editorial-ab-test failed" },
      { status: 500 },
    );
  }
}
