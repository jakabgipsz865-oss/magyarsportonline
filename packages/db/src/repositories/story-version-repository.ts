import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { stories, storyVersions } from "../schema/index";

export type StoryVersion = typeof storyVersions.$inferSelect;

export interface NewStoryVersionInput {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
  changeSummaryHu: string | null;
  generatedByModel: string;
  isAiGenerated: boolean;
  promptVersion: string;
  factConsistencyScore: number;
}

/**
 * Bounded-context repository for the Hungarian Writer and Publish Gate
 * agents (docs/architecture/02-agents.md §2.5, §2.7).
 */
export class StoryVersionRepository {
  constructor(private readonly db: Database) {}

  /**
   * Assigns `version_number` inside a transaction that locks the parent
   * `stories` row with `SELECT ... FOR UPDATE` (docs/architecture/01-data-model.md
   * §1.5.1, 03-event-flow.md §3.7) instead of an application-side `max+1`
   * read, so two concurrent updates to the same Story cannot compute the
   * same version number.
   */
  async createNextVersion(storyId: string, input: NewStoryVersionInput): Promise<StoryVersion> {
    return this.db.transaction(async (tx) => {
      const [storyRow] = await tx
        .select({ id: stories.id, versionCount: stories.versionCount })
        .from(stories)
        .where(eq(stories.id, storyId))
        .for("update");
      if (!storyRow) {
        throw new Error(`Story "${storyId}" not found`);
      }

      const versionNumber = storyRow.versionCount + 1;
      const [version] = await tx
        .insert(storyVersions)
        .values({
          storyId,
          versionNumber,
          titleHu: input.titleHu,
          leadHu: input.leadHu,
          bodyHu: input.bodyHu,
          changeSummaryHu: input.changeSummaryHu,
          generatedByModel: input.generatedByModel,
          isAiGenerated: input.isAiGenerated,
          promptVersion: input.promptVersion,
          factConsistencyScore: input.factConsistencyScore.toFixed(3),
        })
        .returning();
      if (!version) {
        throw new Error("StoryVersion insert returned no row");
      }

      await tx.update(stories).set({ versionCount: versionNumber }).where(eq(stories.id, storyId));
      return version;
    });
  }

  /** Latest version regardless of publish state — used for the "what changed" diff. */
  async getLatest(storyId: string): Promise<StoryVersion | null> {
    const [row] = await this.db
      .select()
      .from(storyVersions)
      .where(eq(storyVersions.storyId, storyId))
      .orderBy(desc(storyVersions.versionNumber))
      .limit(1);
    return row ?? null;
  }

  async getLatestPublished(storyId: string): Promise<StoryVersion | null> {
    const [row] = await this.db
      .select()
      .from(storyVersions)
      .where(and(eq(storyVersions.storyId, storyId), eq(storyVersions.isPublished, true)))
      .orderBy(desc(storyVersions.versionNumber))
      .limit(1);
    return row ?? null;
  }

  async markPublished(versionId: string): Promise<void> {
    await this.db
      .update(storyVersions)
      .set({ isPublished: true })
      .where(eq(storyVersions.id, versionId));
  }

  /** Full, ascending version history for a Story — the Timeline UI's data source. */
  async listByStoryId(storyId: string): Promise<StoryVersion[]> {
    return this.db
      .select()
      .from(storyVersions)
      .where(eq(storyVersions.storyId, storyId))
      .orderBy(asc(storyVersions.versionNumber));
  }
}
