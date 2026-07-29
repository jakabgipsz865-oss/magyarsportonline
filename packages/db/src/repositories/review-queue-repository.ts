import { and, asc, eq } from "drizzle-orm";
import type { ReviewQueueReason, ReviewQueueStatus, RiskLevel } from "@magyarsportonline/shared";
import type { Database } from "../client";
import { reviewQueueItems, stories, storyVersions } from "../schema/index";

export type ReviewQueueItem = typeof reviewQueueItems.$inferSelect;

/** A review felület listanézetéhez szükséges, joinolt olvasási alak. */
export interface PendingReviewItem {
  id: string;
  storyId: string;
  storyVersionId: string;
  reason: ReviewQueueReason;
  createdAt: Date;
  titleHu: string;
  leadHu: string;
  confidenceScore: string | null;
  riskLevel: RiskLevel | null;
  slug: string | null;
}

/** Bounded-context repository for the Publish Gate (docs/architecture/02-agents.md §2.7). */
export class ReviewQueueRepository {
  constructor(private readonly db: Database) {}

  async insert(input: {
    storyId: string;
    storyVersionId: string;
    reason: ReviewQueueReason;
  }): Promise<ReviewQueueItem> {
    const [row] = await this.db
      .insert(reviewQueueItems)
      .values({
        storyId: input.storyId,
        storyVersionId: input.storyVersionId,
        reason: input.reason,
      })
      .returning();
    if (!row) {
      throw new Error("ReviewQueueItem insert returned no row");
    }
    return row;
  }

  async getById(id: string): Promise<ReviewQueueItem | undefined> {
    const [row] = await this.db
      .select()
      .from(reviewQueueItems)
      .where(eq(reviewQueueItems.id, id))
      .limit(1);
    return row;
  }

  /** Nyitott (pending) tételek a Story/verzió megjelenítési mezőivel, legrégebbi elöl. */
  async listPending(): Promise<PendingReviewItem[]> {
    return this.db
      .select({
        id: reviewQueueItems.id,
        storyId: reviewQueueItems.storyId,
        storyVersionId: reviewQueueItems.storyVersionId,
        reason: reviewQueueItems.reason,
        createdAt: reviewQueueItems.createdAt,
        titleHu: storyVersions.titleHu,
        leadHu: storyVersions.leadHu,
        confidenceScore: stories.confidenceScore,
        riskLevel: stories.riskLevel,
        slug: stories.slug,
      })
      .from(reviewQueueItems)
      .innerJoin(stories, eq(reviewQueueItems.storyId, stories.id))
      .innerJoin(storyVersions, eq(reviewQueueItems.storyVersionId, storyVersions.id))
      .where(eq(reviewQueueItems.status, "pending"))
      .orderBy(asc(reviewQueueItems.createdAt));
  }

  /** Lezárja a tételt (approved/rejected/edited) — a Story státuszváltása a hívó felelőssége. */
  async resolve(
    id: string,
    status: Exclude<ReviewQueueStatus, "pending">,
    reviewNote?: string,
  ): Promise<ReviewQueueItem | undefined> {
    const [row] = await this.db
      .update(reviewQueueItems)
      .set({ status, reviewNote: reviewNote ?? null, resolvedAt: new Date() })
      .where(eq(reviewQueueItems.id, id))
      .returning();
    return row;
  }

  /**
   * `listPending()` has no Story-status filter, so a Story archived as
   * `invalid_merge` would otherwise still surface here through a stale
   * pending review item. Called by the invalid-merge repair operation
   * (2026-07-29) to reject every pending item for the archived Story
   * before/alongside marking it, so it structurally cannot appear in the
   * admin review/publish queue either.
   */
  async rejectAllPendingForStory(storyId: string, reviewNote: string): Promise<void> {
    await this.db
      .update(reviewQueueItems)
      .set({ status: "rejected", reviewNote, resolvedAt: new Date() })
      .where(and(eq(reviewQueueItems.storyId, storyId), eq(reviewQueueItems.status, "pending")));
  }
}
