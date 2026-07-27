import type { ReviewQueueReason } from "@magyarsportonline/shared";
import type { Database } from "../client";
import { reviewQueueItems } from "../schema/index";

export type ReviewQueueItem = typeof reviewQueueItems.$inferSelect;

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
}
