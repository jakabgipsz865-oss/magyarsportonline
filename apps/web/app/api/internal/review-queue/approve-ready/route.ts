import { deduplication, publishGate } from "@magyarsportonline/agents";
import { NextResponse, type NextRequest } from "next/server";
import { createRepositories } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";
import { approveReviewItem } from "../../../../../lib/review";

export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const createdAfterRaw = request.nextUrl.searchParams.get("createdAfter");
  const createdAfter = createdAfterRaw ? new Date(createdAfterRaw) : null;
  if (!createdAfter || Number.isNaN(createdAfter.getTime())) {
    return NextResponse.json({ error: "valid createdAfter is required" }, { status: 400 });
  }
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(50, Math.max(1, Math.floor(requestedLimit)))
    : 20;

  const repos = createRepositories();
  const candidates = await repos.reviewQueueRepository.listPending({
    createdAfter,
    limit: limit * 3,
  });
  const approved: Array<{ itemId: string; storyId: string; slug: string | null }> = [];
  const blocked: Array<{
    itemId: string;
    reason: string;
    blockers?: publishGate.PublicationBlocker[];
  }> = [];

  for (const item of candidates) {
    if (approved.length >= limit) break;
    const rawArticles = await repos.rawArticleRepository.listByStoryId(item.storyId);
    const sourceIds = [...new Set(rawArticles.map((article) => article.sourceId))];
    const sourceRows = await Promise.all(
      sourceIds.map((sourceId) => repos.sourceRepository.getById(sourceId)),
    );
    const sourceById = new Map(
      sourceRows.filter((source) => source !== null).map((source) => [source.id, source]),
    );
    const detectedSports = rawArticles.map(
      (article) =>
        deduplication.inferSportFromUrl(article.sourceUrl) ??
        deduplication.inferSportFromSource(sourceById.get(article.sourceId) ?? null),
    );
    if (detectedSports.length === 0 || detectedSports.some((sport) => sport !== "football")) {
      blocked.push({ itemId: item.id, reason: "not_unambiguously_football" });
      continue;
    }

    const result = await approveReviewItem(item.id, repos);
    if (!result.ok) {
      blocked.push({
        itemId: item.id,
        reason: result.error,
        ...(result.error === "publication_blocked" ? { blockers: result.blockers } : {}),
      });
      continue;
    }
    const story = await repos.storyRepository.getById(item.storyId);
    approved.push({ itemId: item.id, storyId: item.storyId, slug: story?.slug ?? null });
  }

  return NextResponse.json({ approvedCount: approved.length, approved, blocked });
}
