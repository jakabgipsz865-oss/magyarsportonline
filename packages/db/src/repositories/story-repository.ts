import type { RiskLevel, StoryStatus } from "@magyarsportonline/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../client";
import { isUniqueViolation } from "../errors";
import { withFingerprintLock } from "../locking";
import { stories, storyFingerprints } from "../schema/index";

export type Story = typeof stories.$inferSelect;

export interface StoryDraft {
  canonicalTitle: string;
  categoryId: string | null;
  confidenceScore: number;
  riskLevel: RiskLevel | null;
  isDeveloping: boolean;
  imageUrl: string | null;
}

/**
 * Bounded-context repository for the Story Merge, Fact Verification, SEO and
 * Publish Gate agents (docs/architecture/02-agents.md §2.3, §2.4, §2.6, §2.7).
 */
export class StoryRepository {
  constructor(private readonly db: Database) {}

  async getById(id: string): Promise<Story | null> {
    const [row] = await this.db.select().from(stories).where(eq(stories.id, id)).limit(1);
    return row ?? null;
  }

  async getBySlug(slug: string): Promise<Story | null> {
    const [row] = await this.db.select().from(stories).where(eq(stories.slug, slug)).limit(1);
    return row ?? null;
  }

  /**
   * Race-condition-safe find-or-create keyed by the coarse dedup fingerprint
   * (docs/architecture/03-event-flow.md §3.7, 01-data-model.md §1.5.1). Runs
   * inside a transaction serialized by `pg_advisory_xact_lock` on
   * `fingerprintHash` — a second, concurrent call for the same fingerprint
   * blocks until the first commits, then finds the `story_fingerprints` row
   * and returns `created: false` (MATCH) instead of racing a duplicate Story
   * (NEW_STORY).
   */
  async createOrMatchByFingerprint(
    fingerprintHash: string,
    draft: StoryDraft,
  ): Promise<{ story: Story; created: boolean }> {
    return this.db.transaction(async (tx) => {
      return withFingerprintLock(tx, fingerprintHash, async () => {
        const [existing] = await tx
          .select()
          .from(storyFingerprints)
          .where(eq(storyFingerprints.fingerprintHash, fingerprintHash))
          .limit(1);

        if (existing) {
          const [story] = await tx
            .select()
            .from(stories)
            .where(eq(stories.id, existing.storyId))
            .limit(1);
          if (!story) {
            throw new Error(
              `story_fingerprints row "${fingerprintHash}" references a missing story "${existing.storyId}"`,
            );
          }
          return { story, created: false };
        }

        const [story] = await tx
          .insert(stories)
          .values({
            canonicalTitle: draft.canonicalTitle,
            categoryId: draft.categoryId,
            confidenceScore: draft.confidenceScore.toFixed(3),
            riskLevel: draft.riskLevel,
            isDeveloping: draft.isDeveloping,
            imageUrl: draft.imageUrl,
          })
          .returning();
        if (!story) {
          throw new Error("Story insert returned no row");
        }
        await tx.insert(storyFingerprints).values({ fingerprintHash, storyId: story.id });
        return { story, created: true };
      });
    });
  }

  async updateFactVerificationResult(
    storyId: string,
    result: { confidenceScore: number; riskLevel: RiskLevel; isDeveloping: boolean },
  ): Promise<void> {
    await this.db
      .update(stories)
      .set({
        confidenceScore: result.confidenceScore.toFixed(3),
        riskLevel: result.riskLevel,
        isDeveloping: result.isDeveloping,
        status: "fact_checked",
        lastUpdatedAt: new Date(),
      })
      .where(eq(stories.id, storyId));
  }

  async updateStatus(storyId: string, status: StoryStatus): Promise<void> {
    await this.db
      .update(stories)
      .set({ status, lastUpdatedAt: new Date() })
      .where(eq(stories.id, storyId));
  }

  /**
   * Backfills `imageUrl` from a later corroborating source when the Story's
   * initial source didn't have one — never overwrites an image already set
   * (`and(..., isNull(stories.imageUrl))`), so this is safe to call on every
   * corroboration regardless of whether the Story already has an image.
   */
  async setImageUrlIfMissing(storyId: string, imageUrl: string): Promise<void> {
    await this.db
      .update(stories)
      .set({ imageUrl })
      .where(and(eq(stories.id, storyId), isNull(stories.imageUrl)));
  }

  /** Best-effort slug assignment — relies on the `UNIQUE` constraint as the real guard against concurrent collisions; caller retries with a new candidate on `false`. */
  async trySetSlug(storyId: string, slug: string): Promise<boolean> {
    try {
      await this.db.update(stories).set({ slug }).where(eq(stories.id, storyId));
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  async publish(storyId: string, versionId: string, publishedAt: Date): Promise<void> {
    await this.db
      .update(stories)
      .set({
        status: "published",
        currentVersionId: versionId,
        publishedAt,
        lastUpdatedAt: publishedAt,
      })
      .where(eq(stories.id, storyId));
  }
}
