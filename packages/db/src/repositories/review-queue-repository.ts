import { and, asc, count, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { ReviewQueueReason, ReviewQueueStatus, RiskLevel } from "@magyarsportonline/shared";
import type { Database } from "../client";
import { reviewQueueItems, stories, storyVersions } from "../schema/index";

export type ReviewQueueItem = typeof reviewQueueItems.$inferSelect;

/**
 * A review felület listanézetéhez szükséges, joinolt olvasási alak.
 * Jóváhagyás ELŐTT a szerkesztőnek látnia kell a teljes magyar cikket
 * (nem csak a cím/lead-et) és a hitelességi mutatót is (2026-07-29,
 * "admin review — teljes bizonyíték jóváhagyás előtt" sprint) — a
 * forrásokat, forráscikk-linkeket, ellentmondásokat és a kép
 * forrását/licencét a hívó (apps/web/lib/review-detail.ts) egészíti ki,
 * mert azok több táblát érintő, per-Story lekérdezést igényelnek.
 */
export interface PendingReviewItem {
  id: string;
  storyId: string;
  storyVersionId: string;
  reason: ReviewQueueReason;
  createdAt: Date;
  titleHu: string;
  leadHu: string;
  bodyHu: string;
  confidenceScore: string | null;
  riskLevel: RiskLevel | null;
  slug: string | null;
  imageUrl: string | null;
  credibilityScore: number | null;
  credibilityBand: string | null;
  credibilityLabelHu: string | null;
  credibilityJustificationHu: string | null;
  lastUpdatedAt: Date;
  /** `false` means the No-LLM passthrough produced this version's content — never real AI-translated Hungarian text (2026-07-29, triage sprint). */
  isAiGenerated: boolean;
  factConsistencyScore: string | null;
  selfCheckFallback: boolean;
  /** Content Quality Gate findings for this version (hungarian-writer/quality-gate.ts) — empty/null means none found. */
  qualityIssues: unknown;
}

export interface PendingReviewFilters {
  itemId?: string;
  createdAfter?: Date;
  limit?: number;
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
  async listPending(filters: PendingReviewFilters = {}): Promise<PendingReviewItem[]> {
    return this.db
      .select({
        id: reviewQueueItems.id,
        storyId: reviewQueueItems.storyId,
        storyVersionId: reviewQueueItems.storyVersionId,
        reason: reviewQueueItems.reason,
        createdAt: reviewQueueItems.createdAt,
        titleHu: storyVersions.titleHu,
        leadHu: storyVersions.leadHu,
        bodyHu: storyVersions.bodyHu,
        confidenceScore: stories.confidenceScore,
        riskLevel: stories.riskLevel,
        slug: stories.slug,
        imageUrl: stories.imageUrl,
        credibilityScore: stories.credibilityScore,
        credibilityBand: stories.credibilityBand,
        credibilityLabelHu: stories.credibilityLabelHu,
        credibilityJustificationHu: stories.credibilityJustificationHu,
        lastUpdatedAt: stories.lastUpdatedAt,
        isAiGenerated: storyVersions.isAiGenerated,
        factConsistencyScore: storyVersions.factConsistencyScore,
        selfCheckFallback: storyVersions.selfCheckFallback,
        qualityIssues: storyVersions.qualityIssues,
      })
      .from(reviewQueueItems)
      .innerJoin(stories, eq(reviewQueueItems.storyId, stories.id))
      .innerJoin(storyVersions, eq(reviewQueueItems.storyVersionId, storyVersions.id))
      .where(
        and(
          eq(reviewQueueItems.status, "pending"),
          or(isNull(reviewQueueItems.snoozedUntil), lte(reviewQueueItems.snoozedUntil, new Date())),
          filters.itemId ? eq(reviewQueueItems.id, filters.itemId) : undefined,
          filters.createdAfter ? gte(reviewQueueItems.createdAt, filters.createdAfter) : undefined,
        ),
      )
      .orderBy(asc(reviewQueueItems.createdAt))
      .limit(filters.limit ?? 10_000);
  }

  /** Dashboard counter without loading joined StoryVersion content. */
  async countPending(): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(reviewQueueItems)
      .where(
        and(
          eq(reviewQueueItems.status, "pending"),
          or(isNull(reviewQueueItems.snoozedUntil), lte(reviewQueueItems.snoozedUntil, new Date())),
        ),
      );
    return row?.value ?? 0;
  }

  async countPendingByReasonSince(since: Date): Promise<Array<{ reason: string; count: number }>> {
    const rows = await this.db.execute<{ reason: string; count: number | string }>(sql`
      SELECT reason::text AS reason, count(*) AS count
      FROM ${reviewQueueItems}
      WHERE status = 'pending' AND created_at >= ${since.toISOString()}::timestamptz
      GROUP BY reason ORDER BY count(*) DESC, reason
    `);
    return rows.map((row) => ({ reason: row.reason, count: Number(row.count) }));
  }

  /** "Később" — a tétel `pending` marad, csak `until`-ig kikerül a `listPending()` eredményéből (nem terminal döntés). */
  async snooze(id: string, until: Date): Promise<void> {
    await this.db
      .update(reviewQueueItems)
      .set({ snoozedUntil: until })
      .where(eq(reviewQueueItems.id, id));
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
