import { NextResponse, type NextRequest } from "next/server";
import { createRepositories } from "../../../../lib/db";
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
 * mid-auto-repair or slated for archival. The endpoint deliberately returns
 * the complete editorial evidence already assembled for `/admin/review`
 * (Hungarian body, source links, credibility and quality findings), because
 * approving from only a title and lead would be a blind publication action.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const repos = createRepositories();
  const requestedItemId = request.nextUrl.searchParams.get("itemId");
  const { items: selectedItems } = await listTriagedReviewItems(
    repos,
    requestedItemId ?? undefined,
  );

  const responseItems = await Promise.all(
    selectedItems.map(async (item) => ({
      id: item.id,
      storyId: item.storyId,
      storyVersionId: item.storyVersionId,
      reason: item.reason,
      triageCategory: item.triageCategory,
      titleHu: item.titleHu,
      leadHu: item.leadHu,
      bodyHu: item.bodyHu,
      confidenceScore: item.confidenceScore,
      riskLevel: item.riskLevel,
      credibilityScore: item.credibilityScore,
      credibilityBand: item.credibilityBand,
      credibilityLabelHu: item.credibilityLabelHu,
      credibilityJustificationHu: item.credibilityJustificationHu,
      isAiGenerated: item.isAiGenerated,
      factConsistencyScore:
        item.factConsistencyScore === null ? null : Number(item.factConsistencyScore),
      selfCheckFallback: item.selfCheckFallback,
      qualityIssues: item.qualityIssues,
      triageReasonsHu: item.triageReasonsHu,
      sources: item.sources,
      fullArticleSourceCount: item.fullArticleSourceCount,
      contradictions: item.contradictions,
      originalSources: requestedItemId
        ? await repos.storySourceRepository.originalContentByStoryId(item.storyId)
        : undefined,
      slug: item.slug,
      createdAt: item.createdAt,
    })),
  );

  return NextResponse.json({
    total: selectedItems.length,
    items: responseItems,
  });
}
