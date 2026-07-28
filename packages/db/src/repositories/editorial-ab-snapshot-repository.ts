import { desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { editorialAbSnapshots } from "../schema/index";

export type EditorialAbSnapshotRow = typeof editorialAbSnapshots.$inferSelect;

export interface EditorialAbSnapshotInput {
  storyId: string;
  titleA: string;
  leadA: string;
  bodyA: string;
  titleB: string;
  leadB: string;
  bodyB: string;
  rewriteAccepted: boolean;
  rejectionKind: string | null;
  rejectionReason: string[] | null;
  qualityA: unknown;
  qualityB: unknown;
  judge: unknown;
  perCallUsage: unknown;
  totalUsage: unknown;
  durationMs: number;
  lexiconMatches: unknown;
  originalSources: unknown;
}

/**
 * One row per Story, upserted — see editorial-ab-snapshots.ts's schema
 * comment for why this is a "latest known result", not an append-only run
 * log. Backs the read-only `/internal/editorial-ab-review` admin page.
 */
export class EditorialAbSnapshotRepository {
  constructor(private readonly db: Database) {}

  async upsert(input: EditorialAbSnapshotInput): Promise<void> {
    await this.db
      .insert(editorialAbSnapshots)
      .values({
        storyId: input.storyId,
        titleA: input.titleA,
        leadA: input.leadA,
        bodyA: input.bodyA,
        titleB: input.titleB,
        leadB: input.leadB,
        bodyB: input.bodyB,
        rewriteAccepted: input.rewriteAccepted,
        rejectionKind: input.rejectionKind,
        rejectionReason: input.rejectionReason,
        qualityA: input.qualityA,
        qualityB: input.qualityB,
        judge: input.judge,
        perCallUsage: input.perCallUsage,
        totalUsage: input.totalUsage,
        durationMs: input.durationMs,
        lexiconMatches: input.lexiconMatches,
        originalSources: input.originalSources,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: editorialAbSnapshots.storyId,
        set: {
          titleA: input.titleA,
          leadA: input.leadA,
          bodyA: input.bodyA,
          titleB: input.titleB,
          leadB: input.leadB,
          bodyB: input.bodyB,
          rewriteAccepted: input.rewriteAccepted,
          rejectionKind: input.rejectionKind,
          rejectionReason: input.rejectionReason,
          qualityA: input.qualityA,
          qualityB: input.qualityB,
          judge: input.judge,
          perCallUsage: input.perCallUsage,
          totalUsage: input.totalUsage,
          durationMs: input.durationMs,
          lexiconMatches: input.lexiconMatches,
          originalSources: input.originalSources,
          updatedAt: new Date(),
        },
      });
  }

  /** Latest-updated first — the review page's default ordering. */
  async listAll(): Promise<EditorialAbSnapshotRow[]> {
    return this.db
      .select()
      .from(editorialAbSnapshots)
      .orderBy(desc(editorialAbSnapshots.updatedAt));
  }

  async deleteByStoryId(storyId: string): Promise<void> {
    await this.db.delete(editorialAbSnapshots).where(eq(editorialAbSnapshots.storyId, storyId));
  }
}
