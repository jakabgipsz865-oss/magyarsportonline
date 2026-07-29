import { deduplication, factVerification, publishGate } from "@magyarsportonline/agents";
import { createRepositories, type Repositories } from "./db";
import { listPendingReviewDetails, type PendingReviewDetail } from "./review-detail";
import { reprocessStoryById } from "./pipeline";

const { classifyStoryTriage } = publishGate;
type StoryTriageCategory = publishGate.StoryTriageCategory;

/** Wider than the live matcher's 3-day candidate lookback and the missed-merge-review tool's 14-day window — duplicates can surface from anywhere in the recent backlog. */
const DUPLICATE_SCAN_WINDOW_DAYS = 30;

/** Reprocessing a Story calls real LLM stages (Hungarian Writer, SEO) synchronously — bounded per sweep so a single request can't time out; a repeated sweep call drains more, same pattern as scheduled-pipeline.yml's job-processing loop. */
const MAX_REPROCESS_PER_SWEEP = 4;
/**
 * Recomputing credibility is pure DB read/write, no LLM call — much cheaper
 * than a reprocess, so it gets a larger per-sweep batch, run concurrently
 * (see `credibilityOnlyResults` below). Two real production runs at 100
 * (sequential) and then 60 (parallel) both still hit Vercel's
 * FUNCTION_INVOCATION_TIMEOUT at ~250s — the 60-item parallel run
 * succeeded once at 245s and failed once at 251s, i.e. right at the edge
 * rather than comfortably under it. Lowered to 25 for real headroom; a
 * sweep is designed to be called repeatedly to drain a larger backlog, so
 * a smaller reliable batch beats a larger one that sometimes times out
 * (and a timed-out call still loses whatever work hadn't committed yet).
 */
const MAX_CREDIBILITY_RECOMPUTES_PER_SWEEP = 25;

export interface TriagedReviewItem extends PendingReviewDetail {
  triageCategory: StoryTriageCategory;
  triageReasonsHu: string[];
}

export type TriageCounts = Record<StoryTriageCategory, number>;

export interface TriageSummary {
  items: TriagedReviewItem[];
  countsByCategory: TriageCounts;
}

function emptyCounts(): TriageCounts {
  return {
    ready_for_review: 0,
    auto_repair_required: 0,
    human_decision_required: 0,
    reject_or_archive: 0,
  };
}

function qualityIssueKindsOf(qualityIssues: unknown): string[] {
  if (!Array.isArray(qualityIssues)) {
    return [];
  }
  return qualityIssues
    .map((issue) =>
      typeof issue === "object" && issue !== null ? (issue as { kind?: unknown }).kind : null,
    )
    .filter((kind): kind is string => typeof kind === "string");
}

/**
 * Classifies every pending review-queue item into exactly one of the 4
 * triage categories (2026-07-29, "queue-tisztító és triage réteg" sprint) —
 * read-only, no side effects. Reused by both the admin page (for tabs/
 * counts) and `runTriageSweep` (for a before-sweep snapshot).
 */
export async function listTriagedReviewItems(
  repos: Repositories = createRepositories(),
  itemId?: string,
): Promise<TriageSummary> {
  const [items, entities, pendingMergeDecisions, comparisonRows, decidedMissedMerges] =
    await Promise.all([
      listPendingReviewDetails(repos, itemId),
      repos.entityRepository.listAll(),
      repos.storyMatchRepository.listPendingReview(1000),
      repos.storyMatchRepository.listAllForMatchComparison(
        new Date(Date.now() - DUPLICATE_SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      ),
      repos.missedMergeReviewRepository.listAll(),
    ]);

  const ambiguousStoryIds = new Set<string>();
  for (const decision of pendingMergeDecisions) {
    if (decision.candidateStoryId) ambiguousStoryIds.add(decision.candidateStoryId);
    if (decision.resultingStoryId) ambiguousStoryIds.add(decision.resultingStoryId);
  }

  const keptSeparatePairKeys = new Set(
    decidedMissedMerges
      .filter((row) => row.decision === "keep_separate")
      .map((row) => `${row.storyAId}|${row.storyBId}`),
  );
  const lastUpdatedById = new Map(comparisonRows.map((row) => [row.storyId, row.lastUpdatedAt]));
  const confidentDuplicateIds = new Set<string>();
  for (const pair of deduplication.computeMissedMergeCandidatePairs(comparisonRows)) {
    if (pair.matchScore < deduplication.AUTO_MERGE_THRESHOLD) continue;
    if (keptSeparatePairKeys.has(`${pair.storyAId}|${pair.storyBId}`)) continue;
    const aDate = lastUpdatedById.get(pair.storyAId);
    const bDate = lastUpdatedById.get(pair.storyBId);
    if (!aDate || !bDate) continue;
    const newer = aDate.getTime() >= bDate.getTime() ? pair.storyAId : pair.storyBId;
    confidentDuplicateIds.add(newer);
  }

  const items_ = await Promise.all(
    items.map(async (item): Promise<TriagedReviewItem> => {
      const rawArticles = await repos.rawArticleRepository.listByStoryId(item.storyId);
      const detectedSport =
        rawArticles
          .map((article) => deduplication.inferSportFromUrl(article.sourceUrl))
          .find((s) => s !== null) ?? null;
      const hasAnyRecognizedEntity = rawArticles.some(
        (article) => deduplication.extractEntityMentions(article, entities).length > 0,
      );
      const ageDays = (Date.now() - item.lastUpdatedAt.getTime()) / (24 * 60 * 60 * 1000);

      const { category, reasonsHu } = classifyStoryTriage({
        isAiGenerated: item.isAiGenerated,
        qualityIssueKinds: qualityIssueKindsOf(item.qualityIssues),
        credibilityScore: item.credibilityScore,
        hasContradiction: item.contradictions.length > 0,
        hasAmbiguousMergeDecision: ambiguousStoryIds.has(item.storyId),
        isConfidentDuplicate: confidentDuplicateIds.has(item.storyId),
        detectedSport,
        hasAnyRecognizedEntity,
        ageDays,
      });

      return { ...item, triageCategory: category, triageReasonsHu: reasonsHu };
    }),
  );

  const countsByCategory = emptyCounts();
  for (const item of items_) {
    countsByCategory[item.triageCategory] += 1;
  }

  return { items: items_, countsByCategory };
}

export interface TriageSweepResult {
  /** Categorization BEFORE this sweep's actions ran. */
  before: TriageCounts;
  autoRepaired: number;
  archived: number;
  errors: Array<{ storyId: string; error: string }>;
}

/**
 * Executes the automatic side of the triage: reprocesses/recomputes
 * `auto_repair_required` items (bounded batch — call repeatedly to drain a
 * larger backlog) and archives `reject_or_archive` items (Story ->
 * `retracted`, review item -> `rejected`) — never touches
 * `ready_for_review`/`human_decision_required` items, those stay for a
 * human via `/admin/review`.
 */
export async function runTriageSweep(
  repos: Repositories = createRepositories(),
): Promise<TriageSweepResult> {
  const { items, countsByCategory } = await listTriagedReviewItems(repos);
  const errors: Array<{ storyId: string; error: string }> = [];
  let autoRepaired = 0;
  let archived = 0;

  const repairable = items.filter((item) => item.triageCategory === "auto_repair_required");

  // Two independent batch caps: recomputing credibility is cheap (DB
  // read/write only), so it gets a much larger per-sweep allowance than
  // reprocessing (which calls real LLM stages) — an item needing both gets
  // both, as long as it falls within ITS OWN cap.
  const needsCredibility = new Set(
    repairable
      .filter((item) => item.credibilityScore === null)
      .slice(0, MAX_CREDIBILITY_RECOMPUTES_PER_SWEEP)
      .map((item) => item.storyId),
  );
  const needsReprocess = new Set(
    repairable
      .filter((item) => !item.isAiGenerated || qualityIssueKindsOf(item.qualityIssues).length > 0)
      .slice(0, MAX_REPROCESS_PER_SWEEP)
      .map((item) => item.storyId),
  );

  async function recomputeCredibility(storyId: string): Promise<void> {
    await factVerification.recomputeCredibilityForStory(
      {
        factRepository: repos.factRepository,
        storySourceRepository: repos.storySourceRepository,
        storyRepository: repos.storyRepository,
        storyCredibilityHistoryRepository: repos.storyCredibilityHistoryRepository,
      },
      storyId,
    );
  }

  // A real production run at MAX_CREDIBILITY_RECOMPUTES_PER_SWEEP=100 hit
  // Vercel's FUNCTION_INVOCATION_TIMEOUT because 100 sequential DB
  // round-trips (each several queries) added up past the route's 250s
  // budget. Credibility recompute has no LLM call and no cross-item
  // ordering requirement, so items needing ONLY that repair run
  // concurrently — the postgres.js pool (default max 10 connections) caps
  // real parallelism, but that's still a large win over one-at-a-time.
  // Items also needing a (rate-limit-sensitive) LLM reprocess stay in the
  // sequential loop below so reprocess calls aren't fired concurrently.
  const credibilityOnlyIds = [...needsCredibility].filter((id) => !needsReprocess.has(id));
  const credibilityOnlyResults = await Promise.allSettled(
    credibilityOnlyIds.map((storyId) => recomputeCredibility(storyId)),
  );
  credibilityOnlyResults.forEach((result, index) => {
    const storyId = credibilityOnlyIds[index];
    if (!storyId) return;
    if (result.status === "fulfilled") {
      autoRepaired += 1;
    } else {
      errors.push({
        storyId,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  for (const item of repairable) {
    const doReprocess = needsReprocess.has(item.storyId);
    if (!doReprocess) {
      continue; // handled above (concurrently) or over this call's cap
    }
    const doCredibility = needsCredibility.has(item.storyId);
    try {
      if (doCredibility) {
        await recomputeCredibility(item.storyId);
      }
      await reprocessStoryById(item.storyId);
      autoRepaired += 1;
    } catch (error) {
      errors.push({
        storyId: item.storyId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const toArchive = items.filter((item) => item.triageCategory === "reject_or_archive");
  for (const item of toArchive) {
    try {
      await repos.storyRepository.updateStatus(item.storyId, "retracted");
      await repos.reviewQueueRepository.resolve(
        item.id,
        "rejected",
        item.triageReasonsHu.join(" "),
      );
      archived += 1;
    } catch (error) {
      errors.push({
        storyId: item.storyId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { before: countsByCategory, autoRepaired, archived, errors };
}
