import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../client";
import { socialPosts } from "../schema/index";

export type SocialPost = typeof socialPosts.$inferSelect;

export const FACEBOOK_RETRYABLE_ERROR_CODES = [
  "facebook_rate_limited",
  "facebook_temporary_error",
] as const;

export interface FacebookSocialPostInput {
  storyId: string;
  storyVersionId: string;
  postText: string;
  canonicalUrl: string;
}

export interface FacebookMetrics {
  queued: number;
  posting: number;
  posted24h: number;
  failed24h: number;
  lastPostedAt: Date | null;
  lastErrorCode: string | null;
  lastExternalPostId: string | null;
}

/** Persistence and atomic claims for the non-idempotent Facebook Page API. */
export class SocialPostRepository {
  constructor(private readonly db: Database) {}

  async createFacebookQueued(
    input: FacebookSocialPostInput,
  ): Promise<{ post: SocialPost; created: boolean }> {
    const [created] = await this.db
      .insert(socialPosts)
      .values({
        ...input,
        platform: "facebook",
        status: "queued",
      })
      .onConflictDoNothing()
      .returning();
    if (created) return { post: created, created: true };

    const [existing] = await this.db
      .select()
      .from(socialPosts)
      .where(and(eq(socialPosts.storyId, input.storyId), eq(socialPosts.platform, "facebook")))
      .limit(1);
    if (!existing) throw new Error("Facebook social post conflict returned no existing row");
    return { post: existing, created: false };
  }

  async getById(id: string): Promise<SocialPost | null> {
    const [row] = await this.db.select().from(socialPosts).where(eq(socialPosts.id, id)).limit(1);
    return row ?? null;
  }

  async listPendingFacebookEnqueue(limit = 25): Promise<SocialPost[]> {
    return this.db
      .select()
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.platform, "facebook"),
          eq(socialPosts.status, "queued"),
          isNull(socialPosts.enqueuedAt),
        ),
      )
      .orderBy(socialPosts.createdAt)
      .limit(limit);
  }

  async markEnqueued(id: string, at = new Date()): Promise<void> {
    await this.db
      .update(socialPosts)
      .set({ enqueuedAt: at, updatedAt: at })
      .where(and(eq(socialPosts.id, id), eq(socialPosts.status, "queued")));
  }

  async claimFacebookForPosting(id: string, at = new Date()): Promise<SocialPost | null> {
    const [claimed] = await this.db
      .update(socialPosts)
      .set({
        status: "posting",
        errorCode: null,
        lastError: null,
        attemptCount: sql`${socialPosts.attemptCount} + 1`,
        lastAttemptAt: at,
        updatedAt: at,
      })
      .where(
        and(
          eq(socialPosts.id, id),
          eq(socialPosts.platform, "facebook"),
          sql`${socialPosts.attemptCount} < 4`,
          sql`(
            ${socialPosts.status} = 'queued'
            OR (${socialPosts.status} = 'failed' AND ${socialPosts.errorCode} IN ('facebook_rate_limited', 'facebook_temporary_error'))
          )`,
        ),
      )
      .returning();
    return claimed ?? null;
  }

  async markPosted(id: string, externalPostId: string, at = new Date()): Promise<void> {
    await this.db
      .update(socialPosts)
      .set({
        status: "posted",
        externalPostId,
        errorCode: null,
        lastError: null,
        postedAt: at,
        updatedAt: at,
      })
      .where(and(eq(socialPosts.id, id), eq(socialPosts.status, "posting")));
  }

  async markFailed(
    id: string,
    errorCode: string,
    lastError: string,
    at = new Date(),
  ): Promise<void> {
    await this.db
      .update(socialPosts)
      .set({ status: "failed", errorCode, lastError: lastError.slice(0, 500), updatedAt: at })
      .where(
        and(eq(socialPosts.id, id), inArray(socialPosts.status, ["queued", "posting", "failed"])),
      );
  }

  async getFacebookMetricsSince(since: Date): Promise<FacebookMetrics> {
    const [counts] = await this.db.execute<{
      queued: number | string;
      posting: number | string;
      posted_24h: number | string;
      failed_24h: number | string;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE status = 'queued') AS queued,
        count(*) FILTER (WHERE status = 'posting') AS posting,
        count(*) FILTER (WHERE status = 'posted' AND posted_at >= ${since.toISOString()}::timestamptz) AS posted_24h,
        count(*) FILTER (WHERE status = 'failed' AND updated_at >= ${since.toISOString()}::timestamptz) AS failed_24h
      FROM ${socialPosts}
      WHERE platform = 'facebook'
    `);
    const [latestPosted] = await this.db
      .select({ postedAt: socialPosts.postedAt, externalPostId: socialPosts.externalPostId })
      .from(socialPosts)
      .where(and(eq(socialPosts.platform, "facebook"), eq(socialPosts.status, "posted")))
      .orderBy(desc(socialPosts.postedAt))
      .limit(1);
    const [latestFailure] = await this.db
      .select({ errorCode: socialPosts.errorCode })
      .from(socialPosts)
      .where(and(eq(socialPosts.platform, "facebook"), eq(socialPosts.status, "failed")))
      .orderBy(desc(socialPosts.updatedAt))
      .limit(1);
    return {
      queued: Number(counts?.queued ?? 0),
      posting: Number(counts?.posting ?? 0),
      posted24h: Number(counts?.posted_24h ?? 0),
      failed24h: Number(counts?.failed_24h ?? 0),
      lastPostedAt: latestPosted?.postedAt ?? null,
      lastErrorCode: latestFailure?.errorCode ?? null,
      lastExternalPostId: latestPosted?.externalPostId ?? null,
    };
  }
}
