import type { MissedMergeReviewDecision } from "@magyarsportonline/shared";
import { count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "../client";
import { missedMergeReviews } from "../schema/index";

export type MissedMergeReview = typeof missedMergeReviews.$inferSelect;

export interface UpsertMissedMergeCandidateInput {
  storyAId: string;
  storyBId: string;
  candidateType: "exact" | "adjacent";
  matchScore: number;
  matchedEntities: unknown;
  differingEntities: unknown;
  decisionReasonHu: string;
}

/**
 * Bounded-context repository for the missed-merge admin review tool
 * (2026-07-29, "admin merge-review felület" sprint, docs/open-decisions.md
 * #14 follow-up). Candidate pairs are re-discovered on every admin page load
 * (`computeMissedMergeCandidatePairs`) and upserted here so a pair already
 * decided keeps its decision even if it's re-surfaced by a later scan, and
 * so the growing set of decisions is queryable for the regression test
 * suite and the (gated) precision/recall report.
 */
export class MissedMergeReviewRepository {
  constructor(private readonly db: Database) {}

  /**
   * Inserts freshly-discovered candidate pairs that aren't already tracked
   * (matched on the (story_a_id, story_b_id) unique pair) — never touches
   * an existing row's `decision`, so a re-scan can't silently reset a
   * human's earlier call. Callers must pass `storyAId`/`storyBId` with the
   * lexicographically smaller UUID first (matching `computeMissedMergeCandidatePairs`'s
   * own ordering), which is also what the unique index relies on.
   */
  async upsertCandidates(candidates: UpsertMissedMergeCandidateInput[]): Promise<void> {
    for (const candidate of candidates) {
      await this.db
        .insert(missedMergeReviews)
        .values({
          storyAId: candidate.storyAId,
          storyBId: candidate.storyBId,
          candidateType: candidate.candidateType,
          matchScore: candidate.matchScore,
          matchedEntities: candidate.matchedEntities,
          differingEntities: candidate.differingEntities,
          decisionReasonHu: candidate.decisionReasonHu,
        })
        .onConflictDoNothing({
          target: [missedMergeReviews.storyAId, missedMergeReviews.storyBId],
        });
    }
  }

  /** Pending (decision IS NULL) reviews, highest match score first — the admin page's default listing. */
  async listPending(): Promise<MissedMergeReview[]> {
    return this.db
      .select()
      .from(missedMergeReviews)
      .where(isNull(missedMergeReviews.decision))
      .orderBy(desc(missedMergeReviews.matchScore));
  }

  /** Dashboard counter without loading candidate JSON payloads. */
  async countPending(): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(missedMergeReviews)
      .where(isNull(missedMergeReviews.decision));
    return row?.value ?? 0;
  }

  /** Every review regardless of decision state, most recently updated first — audit/history view. */
  async listAll(): Promise<MissedMergeReview[]> {
    return this.db.select().from(missedMergeReviews).orderBy(desc(missedMergeReviews.updatedAt));
  }

  /** Already-decided reviews (any of the 3 outcomes) — the regression/precision-recall ground truth pool. */
  async listDecided(): Promise<MissedMergeReview[]> {
    return this.db
      .select()
      .from(missedMergeReviews)
      .where(isNotNull(missedMergeReviews.decision))
      .orderBy(desc(missedMergeReviews.decidedAt));
  }

  async getById(id: string): Promise<MissedMergeReview | undefined> {
    const [row] = await this.db
      .select()
      .from(missedMergeReviews)
      .where(eq(missedMergeReviews.id, id))
      .limit(1);
    return row;
  }

  async decide(
    id: string,
    decision: MissedMergeReviewDecision,
    noteHu?: string,
  ): Promise<MissedMergeReview | undefined> {
    const [row] = await this.db
      .update(missedMergeReviews)
      .set({
        decision,
        decisionNoteHu: noteHu ?? null,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(missedMergeReviews.id, id))
      .returning();
    return row;
  }
}
