import { asc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { storyCredibilityHistory } from "../schema/index";

export type StoryCredibilityHistoryRow = typeof storyCredibilityHistory.$inferSelect;
export type NewStoryCredibilityHistoryRow = typeof storyCredibilityHistory.$inferInsert;

/** Bounded-context repository for the Fact Verification Agent's credibility scoring step and the admin credibility-review UI. */
export class StoryCredibilityHistoryRepository {
  constructor(private readonly db: Database) {}

  async insert(row: NewStoryCredibilityHistoryRow): Promise<StoryCredibilityHistoryRow> {
    const [inserted] = await this.db.insert(storyCredibilityHistory).values(row).returning();
    if (!inserted) {
      throw new Error(`Failed to insert credibility history row for story "${row.storyId}"`);
    }
    return inserted;
  }

  async listByStoryId(storyId: string): Promise<StoryCredibilityHistoryRow[]> {
    return this.db
      .select()
      .from(storyCredibilityHistory)
      .where(eq(storyCredibilityHistory.storyId, storyId))
      .orderBy(asc(storyCredibilityHistory.recordedAt));
  }
}
