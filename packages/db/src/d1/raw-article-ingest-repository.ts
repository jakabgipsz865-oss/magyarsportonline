import type { NewRawArticle, RawArticle } from "../repositories/raw-article-repository";
import { d1Date, d1Timestamp, type D1Client } from "./client";

type FetchCandidate = Pick<
  RawArticle,
  | "id"
  | "sourceId"
  | "sourceUrl"
  | "titleOriginal"
  | "publishedAtSource"
  | "imageUrl"
  | "processingOwner"
  | "processingAttempts"
>;

interface FetchRow {
  id: string;
  source_id: string;
  source_url: string;
  title_original: string;
  published_at_source: string | null;
  image_url: string | null;
  processing_owner: string | null;
  processing_attempts: number;
}

function candidate(row: FetchRow): FetchCandidate {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceUrl: row.source_url,
    titleOriginal: row.title_original,
    publishedAtSource: d1Date(row.published_at_source),
    imageUrl: row.image_url,
    processingOwner: row.processing_owner,
    processingAttempts: row.processing_attempts,
  };
}

const eventFor = (id: string, sourceId: string) => ({
  id: crypto.randomUUID(),
  correlation_id: crypto.randomUUID(),
  occurred_at: new Date().toISOString(),
  version: 1,
  trace_id: crypto.randomUUID(),
  type: "source/article.ingested",
  payload: { raw_article_id: id, source_id: sourceId },
});

/** D1 receipt, conditional fetch claims and atomic full-article job creation. */
export class D1RawArticleIngestRepository {
  constructor(private readonly db: D1Client) {}

  async insertTabloid(data: NewRawArticle, enqueue: boolean): Promise<{ id: string } | null> {
    // The RSS receipt path never enqueues until the complete article is saved.
    // A caller needing the combined operation must use upgradeAndEnqueueTabloid.
    if (enqueue) throw new Error("D1 insertTabloid requires receipt-first ingestion");
    const id = data.id ?? crypto.randomUUID();
    return this.db
      .prepare(
        `
      INSERT INTO raw_articles (
        id, source_id, source_url, title_original, body_original, language,
        extracted_entities, ingest_status, published_at_source, image_url,
        subtitle_original, author_original, content_origin, inline_images,
        rss_title, rss_description, rss_guid, first_seen_at, processing_status,
        decision_reason, processing_available_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT DO NOTHING RETURNING id
    `,
      )
      .bind(
        id,
        data.sourceId,
        data.sourceUrl,
        data.titleOriginal,
        data.bodyOriginal,
        data.language,
        JSON.stringify(data.extractedEntities ?? {}),
        data.ingestStatus ?? "ingested",
        data.publishedAtSource ? d1Timestamp(data.publishedAtSource) : null,
        data.imageUrl ?? null,
        data.subtitleOriginal ?? null,
        data.authorOriginal ?? null,
        data.contentOrigin ?? "rss_snippet",
        JSON.stringify(data.inlineImages ?? []),
        data.rssTitle ?? null,
        data.rssDescription ?? null,
        data.rssGuid ?? null,
        data.firstSeenAt ? d1Timestamp(data.firstSeenAt) : null,
        data.processingStatus ?? null,
        data.decisionReason ?? null,
        data.processingAvailableAt ? d1Timestamp(data.processingAvailableAt) : null,
      )
      .first<{ id: string }>();
  }

  async claimTabloidFetchBatch(
    sourceIds: string[],
    limit: number,
    staleLockMs: number,
    now = new Date(),
    since = new Date(0),
  ): Promise<FetchCandidate[]> {
    if (sourceIds.length === 0 || limit <= 0) return [];
    const bounded = Math.min(limit, 4);
    const oldSlots = bounded === 1 ? (Math.floor(now.getTime() / 60_000) % 4 === 0 ? 1 : 0) : 1;
    const nowIso = d1Timestamp(now);
    const staleAt = d1Timestamp(new Date(now.getTime() - staleLockMs));
    const placeholders = sourceIds.map(() => "?").join(",");
    const claimed: FetchCandidate[] = [];
    for (const [slots, direction] of [
      [oldSlots, "ASC"],
      [bounded - oldSlots, "DESC"],
    ] as const) {
      if (slots <= 0) continue;
      const owner = crypto.randomUUID();
      const rows = await this.db
        .prepare(
          `
        UPDATE raw_articles SET processing_status='fetching', processing_owner=?,
          processing_locked_at=?, processing_attempts=processing_attempts+1
        WHERE id IN (
          SELECT id FROM raw_articles WHERE source_id IN (${placeholders})
            AND first_seen_at >= ? AND published_at_source >= ? AND (
            (processing_status IN ('awaiting_full_article','fetch_retry')
              AND processing_available_at <= ?)
            OR (processing_status='fetching' AND processing_locked_at < ?)
          )
          ORDER BY julianday(first_seen_at) ${direction}, id LIMIT ?
        ) RETURNING id, source_id, source_url, title_original,
          published_at_source, image_url, processing_owner, processing_attempts
      `,
        )
        .bind(
          owner,
          nowIso,
          ...sourceIds,
          d1Timestamp(since),
          d1Timestamp(since),
          nowIso,
          staleAt,
          slots,
        )
        .all<FetchRow>();
      claimed.push(...rows.results.map(candidate));
    }
    return claimed;
  }

  async deferTabloidFetch(
    id: string,
    owner: string,
    reason: string,
    attempts: number,
  ): Promise<boolean> {
    const exhausted = attempts >= 5;
    const delayMs = Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000);
    const result = await this.db
      .prepare(
        `
      UPDATE raw_articles SET processing_status=?, decision_reason=?,
        processing_available_at=?, processing_owner=NULL, processing_locked_at=NULL
      WHERE id=? AND processing_owner=? AND processing_status='fetching'
    `,
      )
      .bind(
        exhausted ? "review_unavailable" : "fetch_retry",
        reason,
        exhausted ? null : d1Timestamp(new Date(Date.now() + delayMs)),
        id,
        owner,
      )
      .run();
    return result.meta.changes > 0;
  }

  async upgradeAndEnqueueTabloid(
    id: string,
    data: Pick<
      NewRawArticle,
      | "titleOriginal"
      | "sourceUrl"
      | "subtitleOriginal"
      | "bodyOriginal"
      | "authorOriginal"
      | "publishedAtSource"
      | "imageUrl"
      | "inlineImages"
    >,
    owner?: string,
    activationAt?: Date,
  ): Promise<boolean> {
    if (!owner) throw new Error("D1 full-article upgrade requires a fetch claim owner");
    if (activationAt && data.publishedAtSource && data.publishedAtSource < activationAt) {
      await this.db
        .prepare(
          `
        UPDATE raw_articles SET source_url=?, title_original=?, subtitle_original=?,
          body_original=?, author_original=?, published_at_source=?, image_url=?,
          inline_images=?, content_origin='full_article',
          processing_status='historical_before_activation',
          decision_reason='full_article_published_before_activation',
          processing_available_at=NULL, processing_owner=NULL, processing_locked_at=NULL
        WHERE id=? AND processing_owner=? AND processing_status='fetching'
          AND NOT EXISTS (
            SELECT 1 FROM pipeline_jobs
            WHERE json_extract(event, '$.type')='source/article.ingested'
              AND json_extract(event, '$.payload.raw_article_id')=?
          )
      `,
        )
        .bind(
          data.sourceUrl,
          data.titleOriginal,
          data.subtitleOriginal ?? null,
          data.bodyOriginal,
          data.authorOriginal ?? null,
          d1Timestamp(data.publishedAtSource),
          data.imageUrl ?? null,
          JSON.stringify(data.inlineImages ?? []),
          id,
          owner,
          id,
        )
        .run();
      return false;
    }
    if (!this.db.batch) throw new Error("D1 transactional batch binding is unavailable");
    const existing = await this.db
      .prepare(
        `
      SELECT id FROM pipeline_jobs WHERE json_extract(event, '$.type')='source/article.ingested'
        AND json_extract(event, '$.payload.raw_article_id')=? LIMIT 1
    `,
      )
      .bind(id)
      .first<{ id: string }>();
    if (existing) {
      await this.db
        .prepare(
          `
        UPDATE raw_articles SET processing_status='queued', decision_reason=NULL,
          processing_owner=NULL, processing_locked_at=NULL
        WHERE id=? AND processing_owner=? AND processing_status='fetching'
      `,
        )
        .bind(id, owner)
        .run();
      return false;
    }
    const raw = await this.db
      .prepare(
        `
      SELECT source_id FROM raw_articles WHERE id=? AND processing_owner=?
        AND processing_status='fetching' LIMIT 1
    `,
      )
      .bind(id, owner)
      .first<{ source_id: string }>();
    if (!raw) return false;
    const now = d1Timestamp(new Date());
    const results = await this.db.batch([
      this.db
        .prepare(
          `
        UPDATE raw_articles SET source_url=?, title_original=?, subtitle_original=?,
          body_original=?, author_original=?, published_at_source=?, image_url=?,
          inline_images=?, content_origin='full_article', processing_status='queued',
          decision_reason=NULL
        WHERE id=? AND processing_owner=? AND processing_status='fetching'
          AND NOT EXISTS (
            SELECT 1 FROM pipeline_jobs
            WHERE json_extract(event, '$.type')='source/article.ingested'
              AND json_extract(event, '$.payload.raw_article_id')=?
          )
      `,
        )
        .bind(
          data.sourceUrl,
          data.titleOriginal,
          data.subtitleOriginal ?? null,
          data.bodyOriginal,
          data.authorOriginal ?? null,
          data.publishedAtSource ? d1Timestamp(data.publishedAtSource) : null,
          data.imageUrl ?? null,
          JSON.stringify(data.inlineImages ?? []),
          id,
          owner,
          id,
        ),
      this.db
        .prepare(
          `
        INSERT INTO pipeline_jobs (id, event, status, attempts, max_attempts,
          available_at, claim_version, created_at, updated_at)
        SELECT ?, ?, 'pending', 0, 5, ?, 0, ?, ?
        WHERE EXISTS (SELECT 1 FROM raw_articles WHERE id=? AND processing_owner=?
          AND processing_status='queued' AND content_origin='full_article')
          AND NOT EXISTS (SELECT 1 FROM pipeline_jobs
            WHERE json_extract(event, '$.type')='source/article.ingested'
              AND json_extract(event, '$.payload.raw_article_id')=?)
      `,
        )
        .bind(
          crypto.randomUUID(),
          JSON.stringify(eventFor(id, raw.source_id)),
          now,
          now,
          now,
          id,
          owner,
          id,
        ),
      this.db
        .prepare(
          `
        UPDATE raw_articles SET processing_owner=NULL, processing_locked_at=NULL
        WHERE id=? AND processing_owner=? AND processing_status='queued'
      `,
        )
        .bind(id, owner),
    ]);
    return results[1]?.meta.changes === 1;
  }
}
