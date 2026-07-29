import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../lib/env";
import { listTriagedReviewItems } from "../../../../lib/review-triage";

/**
 * Operational listing endpoint mirroring `/admin/review`'s data, but as JSON
 * behind the `Bearer CRON_SECRET` convention (same as `/api/internal/setup`
 * and `/api/internal/reprocess-no-llm`) rather than the interactive
 * `ADMIN_SECRET` HTTP Basic session — lets a non-interactive caller (e.g. a
 * GitHub Actions run) inspect what's pending review before deciding what to
 * approve via `/api/internal/review-queue/approve`, without ever needing the
 * admin password. Includes each item's triage category (2026-07-29) so a
 * caller can tell which items are actually awaiting a human decision versus
 * mid-auto-repair or slated for archival.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { items } = await listTriagedReviewItems();
  return NextResponse.json({
    total: items.length,
    items: items.map((item) => ({
      id: item.id,
      storyId: item.storyId,
      storyVersionId: item.storyVersionId,
      reason: item.reason,
      triageCategory: item.triageCategory,
      titleHu: item.titleHu,
      leadHu: item.leadHu,
      confidenceScore: item.confidenceScore,
      riskLevel: item.riskLevel,
      slug: item.slug,
      createdAt: item.createdAt,
    })),
  });
}
