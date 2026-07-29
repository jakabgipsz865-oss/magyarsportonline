import { deduplication } from "@magyarsportonline/agents";
import type { MissedMergeReviewDecision } from "@magyarsportonline/shared";
import { createRepositories, type Repositories } from "./db";

/** How far back to scan for missed-merge candidates — deliberately wider than the live matcher's 3-day candidate lookback, since this tool exists specifically to catch backlog pairs the live system never compares against each other. */
const SCAN_WINDOW_DAYS = 14;

export interface MissedMergeReviewStorySide {
  storyId: string;
  titleHu: string;
  leadHu: string;
  canonicalTitle: string;
  slug: string | null;
  status: string;
  lastUpdatedAt: string;
  sources: Array<{ name: string; url: string }>;
}

export interface MissedMergeReviewEntity {
  entityId: string;
  type: string;
  nameCanonical: string;
}

export interface MissedMergeReviewItem {
  id: string;
  candidateType: "exact" | "adjacent";
  matchScore: number;
  matchedEntities: MissedMergeReviewEntity[];
  differingEntities: MissedMergeReviewEntity[];
  decisionReasonHu: string;
  decision: MissedMergeReviewDecision | null;
  decisionNoteHu: string | null;
  decidedAt: string | null;
  storyA: MissedMergeReviewStorySide;
  storyB: MissedMergeReviewStorySide;
}

export interface MissedMergeReviewListing {
  pending: MissedMergeReviewItem[];
  decided: MissedMergeReviewItem[];
  decidedCount: number;
}

async function buildStorySides(
  storyIds: string[],
  repos: Repositories,
): Promise<Map<string, MissedMergeReviewStorySide>> {
  const map = new Map<string, MissedMergeReviewStorySide>();
  await Promise.all(
    storyIds.map(async (storyId) => {
      const story = await repos.storyRepository.getById(storyId);
      if (!story) {
        // Defensive only: a Story referenced by a review row should always
        // still exist (Stories are archived via invalid_merge, never
        // deleted) — but never let one missing row crash the whole page.
        return;
      }
      const [version, sources] = await Promise.all([
        repos.storyVersionRepository.getLatest(storyId),
        repos.storySourceRepository.summaryByStoryId(storyId),
      ]);
      map.set(storyId, {
        storyId,
        titleHu: version?.titleHu ?? story.canonicalTitle,
        leadHu: version?.leadHu ?? "(még nincs magyar szöveg — a pipeline korábbi szakaszában áll)",
        canonicalTitle: story.canonicalTitle,
        slug: story.slug,
        status: story.status,
        lastUpdatedAt: story.lastUpdatedAt.toISOString(),
        sources: sources.map((source) => ({ name: source.name, url: source.url })),
      });
    }),
  );
  return map;
}

/**
 * Recomputes the current missed-merge candidate set (via
 * `computeMissedMergeCandidatePairs`, packages/agents), persists any newly
 * discovered pairs (never touching an already-decided row's decision), and
 * returns the full comparison data — both Stories' Hungarian title/lead,
 * sources, matched/differing entities, match score, and decision reason —
 * for the admin review page.
 */
export async function refreshAndListMissedMergeReviews(
  repos: Repositories = createRepositories(),
): Promise<MissedMergeReviewListing> {
  const sinceDate = new Date(Date.now() - SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const comparisonRows = await repos.storyMatchRepository.listAllForMatchComparison(sinceDate);
  const candidates = deduplication.computeMissedMergeCandidatePairs(comparisonRows);

  await repos.missedMergeReviewRepository.upsertCandidates(
    candidates.map((candidate) => ({
      storyAId: candidate.storyAId,
      storyBId: candidate.storyBId,
      candidateType: candidate.candidateType,
      matchScore: candidate.matchScore,
      matchedEntities: candidate.matchedEntities,
      differingEntities: candidate.differingEntities,
      decisionReasonHu: candidate.decisionReasonHu,
    })),
  );

  const allRows = await repos.missedMergeReviewRepository.listAll();
  const pendingRows = allRows.filter((row) => row.decision === null);
  const decidedRows = allRows.filter((row) => row.decision !== null);

  const storyIds = new Set<string>();
  for (const row of allRows) {
    storyIds.add(row.storyAId);
    storyIds.add(row.storyBId);
  }
  const storySides = await buildStorySides([...storyIds], repos);

  function toItem(row: (typeof allRows)[number]): MissedMergeReviewItem | null {
    const storyA = storySides.get(row.storyAId);
    const storyB = storySides.get(row.storyBId);
    if (!storyA || !storyB) {
      return null;
    }
    return {
      id: row.id,
      candidateType: row.candidateType,
      matchScore: row.matchScore,
      matchedEntities: row.matchedEntities as MissedMergeReviewEntity[],
      differingEntities: row.differingEntities as MissedMergeReviewEntity[],
      decisionReasonHu: row.decisionReasonHu,
      decision: row.decision,
      decisionNoteHu: row.decisionNoteHu,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      storyA,
      storyB,
    };
  }

  return {
    pending: pendingRows.map(toItem).filter((item): item is MissedMergeReviewItem => item !== null),
    decided: decidedRows.map(toItem).filter((item): item is MissedMergeReviewItem => item !== null),
    decidedCount: decidedRows.length,
  };
}

/**
 * Records a human's decision for one candidate pair. Deliberately does NOT
 * merge, split, or otherwise touch either Story's data — see the schema
 * comment on `missed_merge_reviews` (packages/db/src/schema/missed-merge-reviews.ts)
 * for why this is a label, not an action.
 */
export async function decideMissedMergeReview(
  id: string,
  decision: MissedMergeReviewDecision,
  noteHu: string | undefined,
  repos: Repositories = createRepositories(),
): Promise<void> {
  await repos.missedMergeReviewRepository.decide(id, decision, noteHu);
}
