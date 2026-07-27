import { NextResponse, type NextRequest } from "next/server";
import { NO_LLM_MODEL_LABEL } from "@magyarsportonline/llm";
import { createRepositories } from "../../../../lib/db";

/**
 * IDEIGLENES, csak diagnosztikai célú végpont (Content Quality & Reliability
 * Hardening sprint): a `?since=<ISO8601>` query paramtól (ha nincs megadva,
 * a teljes táblákra) összesíti a legutolsó StoryVersion-önkénti minőségi
 * mutatókat (magyar cím arány, üres mezők, teljesen angol kimenetek,
 * fallback arány, Content Quality Gate találatok), a Cloudflare Neuron-/
 * token-fogyasztást (`llm_usage`), és a Publish Gate review-queue okok
 * eloszlását — a sprint GO/NO-GO javaslatához szükséges egyetlen mérőszám-
 * forrás. Nem publikus: a middleware (`/api/admin/:path*`) ADMIN_SECRET HTTP
 * Basic auth mögé helyezi. A vizsgálat lezárása után ez a fájl törlésre kerül.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  if (sinceParam && Number.isNaN(since?.getTime())) {
    return NextResponse.json({ error: "invalid ?since= timestamp" }, { status: 400 });
  }

  const repos = createRepositories();

  const allSummaries = await repos.storyVersionRepository.listLatestVersionSummaries();
  const summaries = since ? allSummaries.filter((row) => row.createdAt >= since) : allSummaries;

  const total = summaries.length;
  const aiGenerated = summaries.filter((row) => row.isAiGenerated);
  const noLlm = summaries.filter((row) => row.generatedByModel === NO_LLM_MODEL_LABEL);

  function hasIssue(row: (typeof summaries)[number], field: string, kind: string): boolean {
    return (
      Array.isArray(row.qualityIssues) &&
      row.qualityIssues.some(
        (issue) =>
          typeof issue === "object" &&
          issue !== null &&
          (issue as { field?: unknown; kind?: unknown }).field === field &&
          (issue as { field?: unknown; kind?: unknown }).kind === kind,
      )
    );
  }

  const emptyTitle = summaries.filter((row) => hasIssue(row, "title", "empty"));
  const emptyLead = summaries.filter((row) => hasIssue(row, "lead", "empty"));
  const emptyBody = summaries.filter((row) => hasIssue(row, "body", "empty"));
  const englishTitle = summaries.filter((row) => hasIssue(row, "title", "looks_english"));
  const fullyEnglish = summaries.filter(
    (row) =>
      hasIssue(row, "title", "looks_english") &&
      hasIssue(row, "lead", "looks_english") &&
      hasIssue(row, "body", "looks_english"),
  );
  const anyQualityIssue = summaries.filter(
    (row) => Array.isArray(row.qualityIssues) && row.qualityIssues.length > 0,
  );
  const gateStatusUnknown = summaries.filter((row) => row.qualityIssues === null);

  const pendingReviewItems = await repos.reviewQueueRepository.listPending();
  const reasonCounts: Record<string, number> = {};
  for (const item of pendingReviewItems) {
    reasonCounts[item.reason] = (reasonCounts[item.reason] ?? 0) + 1;
  }

  const llmUsage = await repos.llmUsageRepository.summarizeSince(since);

  return NextResponse.json({
    since: since?.toISOString() ?? null,
    storyVersions: {
      total,
      aiGeneratedCount: aiGenerated.length,
      noLlmFallbackCount: noLlm.length,
      fallbackRate: total > 0 ? noLlm.length / total : 0,
      hungarianTitleRate: total > 0 ? (total - englishTitle.length - emptyTitle.length) / total : 0,
      emptyTitleCount: emptyTitle.length,
      emptyLeadCount: emptyLead.length,
      emptyBodyCount: emptyBody.length,
      englishTitleCount: englishTitle.length,
      fullyEnglishCount: fullyEnglish.length,
      anyQualityIssueCount: anyQualityIssue.length,
      gateStatusUnknownCount: gateStatusUnknown.length,
    },
    reviewQueue: {
      pendingTotal: pendingReviewItems.length,
      reasonCounts,
    },
    llmUsage,
  });
}
