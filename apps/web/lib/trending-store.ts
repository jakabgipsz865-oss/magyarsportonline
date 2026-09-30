import { TABLOID_PUBLIC_PROMPT, TABLOID_PUBLIC_START } from "@magyarsportonline/shared";
import type { D1Client } from "@magyarsportonline/db/d1";
import { d1Timestamp } from "@magyarsportonline/db/d1";
import {
  fiveMinuteBucket,
  rankTrending,
  selectTrendingHero,
  type ReadSource,
  type TrendingCounts,
  type TrendingSnapshot,
} from "./trending";

interface CountRow {
  storyId: string;
  slug: string;
  publishedAt: string;
  hasImage: number;
  normal1h: number;
  promoted1h: number;
  normal6h: number;
  promoted6h: number;
  normal24h: number;
  promoted24h: number;
}

const publicFilter = `s.published_at >= ? AND length(trim(s.title_hu))>0 AND length(trim(s.body_html))>0 AND EXISTS (
  SELECT 1 FROM json_each(s.version_history_summary) AS version
  WHERE json_extract(version.value, '$.prompt_version') = ?
    AND json_extract(version.value, '$.is_current') = 1
)`;

export async function recordQualifiedRead(
  db: D1Client,
  input: { eventId: string; storyId: string; source: ReadSource; now: Date },
): Promise<boolean> {
  // One insert causes both ledger and rollup writes in a single SQLite transaction.
  const result = await db
    .prepare(
      `
    INSERT OR IGNORE INTO qualified_read_events
      (event_id, story_id, source, occurred_at, bucket_at)
    SELECT ?, s.story_id, ?, ?, ? FROM story_read_model AS s
    WHERE s.story_id = ? AND ${publicFilter}
      AND EXISTS (SELECT 1 FROM stories WHERE id=s.story_id AND status='published')
  `,
    )
    .bind(
      input.eventId,
      input.source,
      input.now.toISOString(),
      fiveMinuteBucket(input.now),
      input.storyId,
      d1Timestamp(new Date(TABLOID_PUBLIC_START)),
      TABLOID_PUBLIC_PROMPT,
    )
    .run();
  return result.meta.changes > 0;
}

export async function refreshTrending(db: D1Client, now: Date): Promise<TrendingSnapshot> {
  const previous = await db
    .prepare("SELECT hero_story_id, hero_selected_at FROM trending_snapshot WHERE id=1")
    .first<{ hero_story_id: string | null; hero_selected_at: string | null }>();
  const cutoff = (hours: number) => fiveMinuteBucket(new Date(now.getTime() - hours * 3_600_000));
  const oneHour = cutoff(1);
  const sixHours = cutoff(6);
  const day = cutoff(24);
  const result = await db
    .prepare(
      `
    SELECT b.story_id AS storyId, s.slug AS slug, s.published_at AS publishedAt,
      CASE WHEN s.image_url IS NOT NULL AND s.image_url != '' THEN 1 ELSE 0 END AS hasImage,
      SUM(CASE WHEN b.bucket_at >= ? THEN b.normal_reads ELSE 0 END) AS normal1h,
      SUM(CASE WHEN b.bucket_at >= ? THEN b.promoted_reads ELSE 0 END) AS promoted1h,
      SUM(CASE WHEN b.bucket_at >= ? THEN b.normal_reads ELSE 0 END) AS normal6h,
      SUM(CASE WHEN b.bucket_at >= ? THEN b.promoted_reads ELSE 0 END) AS promoted6h,
      SUM(b.normal_reads) AS normal24h,
      SUM(b.promoted_reads) AS promoted24h
    FROM qualified_read_buckets AS b
    JOIN story_read_model AS s ON s.story_id = b.story_id
    JOIN stories AS story ON story.id=s.story_id AND story.status='published'
    WHERE b.bucket_at >= ? AND ${publicFilter}
    GROUP BY b.story_id, s.slug, s.published_at, s.image_url
  `,
    )
    .bind(
      oneHour,
      oneHour,
      sixHours,
      sixHours,
      day,
      d1Timestamp(new Date(TABLOID_PUBLIC_START)),
      TABLOID_PUBLIC_PROMPT,
    )
    .all<CountRow>();
  const allRanking = rankTrending(
    result.results.map(
      (row): TrendingCounts => ({
        storyId: row.storyId,
        slug: row.slug,
        publishedAt: row.publishedAt,
        hasImage: row.hasImage === 1,
        normal1h: Number(row.normal1h),
        promoted1h: Number(row.promoted1h),
        normal6h: Number(row.normal6h),
        promoted6h: Number(row.promoted6h),
        normal24h: Number(row.normal24h),
        promoted24h: Number(row.promoted24h),
      }),
    ),
  );
  const hero = selectTrendingHero(
    allRanking,
    previous?.hero_story_id && previous.hero_selected_at
      ? { storyId: previous.hero_story_id, selectedAt: previous.hero_selected_at }
      : null,
    now,
  );
  const ranking = allRanking.slice(0, 30);
  const heldRow = hero && allRanking.find((row) => row.storyId === hero.storyId);
  if (heldRow && !ranking.some((row) => row.storyId === heldRow.storyId)) {
    ranking.splice(29, 1, heldRow);
  }
  const snapshot = { refreshedAt: now.toISOString(), ranking, hero };
  const persisted = await db
    .prepare(
      `
    INSERT INTO trending_snapshot (id, refreshed_at, ranking_json, hero_story_id, hero_selected_at) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET refreshed_at = excluded.refreshed_at,
      ranking_json = excluded.ranking_json, hero_story_id=excluded.hero_story_id,
      hero_selected_at=excluded.hero_selected_at
    WHERE trending_snapshot.refreshed_at <= excluded.refreshed_at
      AND trending_snapshot.hero_selected_at IS ?
  `,
    )
    .bind(
      snapshot.refreshedAt,
      JSON.stringify(ranking),
      hero?.storyId ?? null,
      hero?.selectedAt ?? null,
      previous?.hero_selected_at ?? null,
    )
    .run();
  // Keep the idempotency ledger only long enough for session retries. Buckets
  // retain a margin beyond the rolling window so boundary refreshes are safe.
  await db
    .prepare("DELETE FROM qualified_read_events WHERE occurred_at < ?")
    .bind(new Date(now.getTime() - 48 * 3_600_000).toISOString())
    .run();
  await db.prepare("DELETE FROM qualified_read_buckets WHERE bucket_at < ?").bind(cutoff(25)).run();
  return persisted.meta.changes ? snapshot : ((await readTrendingSnapshot(db)) ?? snapshot);
}

export async function readTrendingSnapshot(db: D1Client): Promise<TrendingSnapshot | null> {
  const row = await db
    .prepare(
      "SELECT refreshed_at, ranking_json, hero_story_id, hero_selected_at FROM trending_snapshot WHERE id = 1",
    )
    .first<{
      refreshed_at: string;
      ranking_json: string;
      hero_story_id: string | null;
      hero_selected_at: string | null;
    }>();
  if (!row) return null;
  const ranking: unknown = JSON.parse(row.ranking_json);
  if (
    !Array.isArray(ranking) ||
    ranking.length > 30 ||
    ranking.some(
      (item) =>
        typeof item !== "object" ||
        item === null ||
        typeof item.storyId !== "string" ||
        typeof item.slug !== "string" ||
        typeof item.publishedAt !== "string" ||
        typeof item.hasImage !== "boolean" ||
        typeof item.score !== "number" ||
        typeof item.normal24h !== "number" ||
        typeof item.promoted24h !== "number",
    )
  )
    throw new Error("invalid trending snapshot");
  // A withdrawal must take effect immediately, even within the hero hold.
  if (ranking.length === 0) return { refreshedAt: row.refreshed_at, ranking: [], hero: null };
  const rankedIds = (ranking as TrendingSnapshot["ranking"]).map((item) => item.storyId);
  const publicIds = await db
    .prepare(
      `SELECT s.story_id FROM story_read_model s
    JOIN stories story ON story.id=s.story_id AND story.status='published'
    WHERE s.story_id IN (${rankedIds.map(() => "?").join(",")}) AND ${publicFilter}`,
    )
    .bind(...rankedIds, d1Timestamp(new Date(TABLOID_PUBLIC_START)), TABLOID_PUBLIC_PROMPT)
    .all<{ story_id: string }>();
  const visible = new Set(publicIds.results.map((item) => item.story_id));
  return {
    refreshedAt: row.refreshed_at,
    ranking: (ranking as TrendingSnapshot["ranking"]).filter((item) => visible.has(item.storyId)),
    hero:
      row.hero_story_id && row.hero_selected_at && visible.has(row.hero_story_id)
        ? { storyId: row.hero_story_id, selectedAt: row.hero_selected_at }
        : null,
  };
}
