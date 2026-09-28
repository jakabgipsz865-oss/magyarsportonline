import type {
  FacebookMetrics,
  FacebookSocialPostInput,
  SocialPost,
} from "../repositories/social-post-repository";
import { d1Date, d1Timestamp, type D1Client } from "./client";

interface SocialPostRow {
  id: string;
  story_id: string;
  story_version_id: string;
  platform: SocialPost["platform"];
  external_post_id: string | null;
  post_text: string;
  canonical_url: string | null;
  status: SocialPost["status"];
  error_code: string | null;
  last_error: string | null;
  attempt_count: number;
  enqueued_at: string | null;
  last_attempt_at: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
}

function hydrate(row: SocialPostRow): SocialPost {
  return {
    id: row.id,
    storyId: row.story_id,
    storyVersionId: row.story_version_id,
    platform: row.platform,
    externalPostId: row.external_post_id,
    postText: row.post_text,
    canonicalUrl: row.canonical_url,
    status: row.status,
    errorCode: row.error_code,
    lastError: row.last_error,
    attemptCount: row.attempt_count,
    enqueuedAt: d1Date(row.enqueued_at),
    lastAttemptAt: d1Date(row.last_attempt_at),
    postedAt: d1Date(row.posted_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * D1 implementation of the existing social post contract. Each claim is one
 * conditional UPDATE RETURNING statement, so overlapping Queue consumers
 * cannot both acquire the same post. Ambiguous Meta outcomes remain terminal
 * until a human reconciles the Page, as in the PostgreSQL implementation.
 */
export class D1SocialPostRepository {
  constructor(private readonly db: D1Client) {}

  async createFacebookQueued(input: FacebookSocialPostInput): Promise<{ post: SocialPost; created: boolean }> {
    const now = d1Timestamp(new Date());
    const created = await this.db.prepare(`
      INSERT INTO social_posts
        (id, story_id, story_version_id, platform, post_text, canonical_url,
         status, attempt_count, created_at, updated_at)
      VALUES (?, ?, ?, 'facebook', ?, ?, 'queued', 0, ?, ?)
      ON CONFLICT DO NOTHING RETURNING *
    `).bind(crypto.randomUUID(), input.storyId, input.storyVersionId, input.postText,
      input.canonicalUrl, now, now).first<SocialPostRow>();
    if (created) return { post: hydrate(created), created: true };

    const existing = await this.db.prepare(
      "SELECT * FROM social_posts WHERE story_id = ? AND platform = 'facebook' LIMIT 1",
    ).bind(input.storyId).first<SocialPostRow>();
    if (!existing) throw new Error("Facebook social post conflict returned no existing row");
    return { post: hydrate(existing), created: false };
  }

  async getById(id: string): Promise<SocialPost | null> {
    const row = await this.db.prepare("SELECT * FROM social_posts WHERE id = ? LIMIT 1")
      .bind(id).first<SocialPostRow>();
    return row ? hydrate(row) : null;
  }

  async listPendingFacebookEnqueue(limit = 25, since?: Date): Promise<SocialPost[]> {
    const rows = await this.db.prepare(`
      SELECT * FROM social_posts
      WHERE platform = 'facebook' AND status = 'queued' AND enqueued_at IS NULL
        AND created_at >= ?
      ORDER BY created_at LIMIT ?
    `).bind(d1Timestamp(since ?? new Date(0)), Math.max(1, Math.min(limit, 100)))
      .all<SocialPostRow>();
    return rows.results.map(hydrate);
  }

  async markEnqueued(id: string, at = new Date()): Promise<void> {
    const now = d1Timestamp(at);
    await this.db.prepare(`
      UPDATE social_posts SET enqueued_at = ?, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).bind(now, now, id).run();
  }

  async claimFacebookForPosting(id: string, at = new Date()): Promise<SocialPost | null> {
    const now = d1Timestamp(at);
    const row = await this.db.prepare(`
      UPDATE social_posts
      SET status = 'posting', error_code = NULL, last_error = NULL,
          attempt_count = attempt_count + 1, last_attempt_at = ?, updated_at = ?
      WHERE id = ? AND platform = 'facebook' AND attempt_count < 4
        AND (status = 'queued' OR
             (status = 'failed' AND error_code IN
               ('facebook_rate_limited', 'facebook_temporary_error')))
      RETURNING *
    `).bind(now, now, id).first<SocialPostRow>();
    return row ? hydrate(row) : null;
  }

  async markPosted(id: string, externalPostId: string, at = new Date()): Promise<void> {
    const now = d1Timestamp(at);
    await this.db.prepare(`
      UPDATE social_posts
      SET status = 'posted', external_post_id = ?, error_code = NULL,
          last_error = NULL, posted_at = ?, updated_at = ?
      WHERE id = ? AND status = 'posting'
    `).bind(externalPostId, now, now, id).run();
  }

  async markFailed(id: string, errorCode: string, lastError: string, at = new Date()): Promise<void> {
    await this.db.prepare(`
      UPDATE social_posts SET status = 'failed', error_code = ?, last_error = ?, updated_at = ?
      WHERE id = ? AND status IN ('queued', 'posting', 'failed')
    `).bind(errorCode, lastError.slice(0, 500), d1Timestamp(at), id).run();
  }

  async getFacebookMetricsSince(since: Date): Promise<FacebookMetrics> {
    const threshold = d1Timestamp(since);
    const counts = await this.db.prepare(`
      SELECT
        sum(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        sum(CASE WHEN status = 'posting' THEN 1 ELSE 0 END) AS posting,
        sum(CASE WHEN status = 'posted' AND posted_at >= ? THEN 1 ELSE 0 END) AS posted_24h,
        sum(CASE WHEN status = 'failed' AND updated_at >= ? THEN 1 ELSE 0 END) AS failed_24h
      FROM social_posts WHERE platform = 'facebook'
    `).bind(threshold, threshold).first<{
      queued: number | null; posting: number | null;
      posted_24h: number | null; failed_24h: number | null;
    }>();
    const latestPosted = await this.db.prepare(`
      SELECT posted_at, external_post_id FROM social_posts
      WHERE platform = 'facebook' AND status = 'posted'
      ORDER BY posted_at DESC LIMIT 1
    `).first<{ posted_at: string | null; external_post_id: string | null }>();
    const latestFailure = await this.db.prepare(`
      SELECT error_code FROM social_posts
      WHERE platform = 'facebook' AND status = 'failed'
      ORDER BY updated_at DESC LIMIT 1
    `).first<{ error_code: string | null }>();
    return {
      queued: counts?.queued ?? 0,
      posting: counts?.posting ?? 0,
      posted24h: counts?.posted_24h ?? 0,
      failed24h: counts?.failed_24h ?? 0,
      lastPostedAt: d1Date(latestPosted?.posted_at ?? null),
      lastErrorCode: latestFailure?.error_code ?? null,
      lastExternalPostId: latestPosted?.external_post_id ?? null,
    };
  }
}
