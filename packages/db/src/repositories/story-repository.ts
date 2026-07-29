import type { RiskLevel, StoryStatus } from "@magyarsportonline/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
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

  /** Admin credibility-review felülethez (2026-07-28) — legutóbb frissített Story-k, publikálási státusztól függetlenül. */
  async listRecent(limit: number): Promise<Story[]> {
    return this.db.select().from(stories).orderBy(desc(stories.lastUpdatedAt)).limit(limit);
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

  /**
   * Unconditional Story creation, no fingerprint dedup lookup (2026-07-29,
   * "téves Story-összevonás megszüntetése" sprint) — for the `needs_review`
   * match decision: the scorer already found a specific-entity-sharing
   * candidate and explicitly decided NOT to merge into it (not enough
   * corroboration yet), so this article must become its OWN Story
   * regardless of what any coarse fingerprint would say — reusing
   * `createOrMatchByFingerprint`'s lookup here would risk silently
   * re-merging into the very candidate the scorer just rejected. Two
   * genuinely-simultaneous `needs_review` articles about the very same new
   * event can, in a rare race, each create their own Story this way — an
   * accepted, documented tradeoff (rule 6 already requires uncertain cases
   * to never auto-merge, so under-merging here is the safe failure mode,
   * not the dangerous one).
   */
  async insertNew(draft: StoryDraft): Promise<Story> {
    const [story] = await this.db
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
    return story;
  }

  /**
   * Locks a KNOWN Story by its own id before appending a new corroborating
   * source to it (2026-07-29, "téves Story-összevonás megszüntetése"
   * sprint) — the scored matcher (packages/agents/src/deduplication/
   * story-match.ts) has already resolved WHICH Story to merge into, so
   * there's no fingerprint ambiguity left to serialize on; locking directly
   * on the resolved story id is simpler and safer than the old coarse
   * fingerprint lock (a second concurrent corroboration for the same Story
   * blocks until the first transaction commits, same
   * `pg_advisory_xact_lock` semantics as `createOrMatchByFingerprint`).
   */
  async lockAndGetById(storyId: string): Promise<Story> {
    return this.db.transaction(async (tx) => {
      return withFingerprintLock(tx, storyId, async () => {
        const [story] = await tx.select().from(stories).where(eq(stories.id, storyId)).limit(1);
        if (!story) {
          throw new Error(`Story "${storyId}" not found`);
        }
        return story;
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

  /**
   * Hitelességi mutató v1 (2026-07-28) — a Fact Verification Agent futása
   * után, vagy admin "Újraszámolás"/"Felülbírálás" műveletkor hívva
   * (packages/agents/src/fact-verification/recompute-credibility.ts). Csak
   * a `credibility*` mezőket írja — nem érinti a régi `confidenceScore`-t,
   * ami külön metrika marad.
   */
  async updateCredibilityResult(
    storyId: string,
    result: {
      score: number;
      band: string;
      labelHu: string;
      justificationHu: string;
      officialConfirmed: boolean;
      corroboratingSourceCount: number;
    },
  ): Promise<void> {
    await this.db
      .update(stories)
      .set({
        credibilityScore: result.score,
        credibilityBand: result.band,
        credibilityLabelHu: result.labelHu,
        credibilityJustificationHu: result.justificationHu,
        credibilityOfficialConfirmed: result.officialConfirmed,
        credibilityCorroboratingCount: result.corroboratingSourceCount,
        credibilityUpdatedAt: new Date(),
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
