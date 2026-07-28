import { NextResponse, type NextRequest } from "next/server";
import { createRepositories } from "../../../../lib/db";
import { env } from "../../../../lib/env";

/**
 * Operational listing endpoint mirroring `/admin/review`'s data, but as JSON
 * behind the `Bearer CRON_SECRET` convention (same as `/api/internal/setup`
 * and `/api/internal/reprocess-no-llm`) rather than the interactive
 * `ADMIN_SECRET` HTTP Basic session — lets a non-interactive caller (e.g. a
 * GitHub Actions run) inspect what's pending review before deciding what to
 * approve via `/api/internal/review-queue/approve`, without ever needing the
 * admin password.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { reviewQueueRepository } = createRepositories();
  const items = await reviewQueueRepository.listPending();
  return NextResponse.json({
    total: items.length,
    items: items.map((item) => ({
      id: item.id,
      storyId: item.storyId,
      storyVersionId: item.storyVersionId,
      reason: item.reason,
      titleHu: item.titleHu,
      leadHu: item.leadHu,
      confidenceScore: item.confidenceScore,
      riskLevel: item.riskLevel,
      slug: item.slug,
      createdAt: item.createdAt,
    })),
  });
}
