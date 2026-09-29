import { TABLOID_PUBLIC_PROMPT, TABLOID_PUBLIC_START } from "@magyarsportonline/shared";
import type {
  NewStoryReadModelRow,
  StoryReadModelRow,
} from "../repositories/story-read-model-repository";
import { d1Timestamp, type D1Client } from "./client";

interface ReadModelSqlRow {
  story_id: string;
  slug: string;
  title_hu: string;
  lead_hu: string;
  body_html: string;
  image_url: string | null;
  inline_images: string;
  is_ai_generated: number;
  meta_description: string | null;
  structured_data: string | null;
  sources_summary: string;
  tags: string;
  category: string | null;
  confidence_score: string | null;
  is_developing: number;
  published_at: string;
  last_updated_at: string;
  version_history_summary: string;
  credibility_summary: string | null;
}

const json = (value: unknown): string => JSON.stringify(value);
const parse = (value: string | null): unknown => (value === null ? null : JSON.parse(value));

function hydrate(row: ReadModelSqlRow): StoryReadModelRow {
  return {
    storyId: row.story_id,
    slug: row.slug,
    titleHu: row.title_hu,
    leadHu: row.lead_hu,
    bodyHtml: row.body_html,
    imageUrl: row.image_url,
    inlineImages: parse(row.inline_images) as StoryReadModelRow["inlineImages"],
    isAiGenerated: row.is_ai_generated !== 0,
    metaDescription: row.meta_description,
    structuredData: parse(row.structured_data),
    sourcesSummary: parse(row.sources_summary),
    tags: parse(row.tags),
    category: parse(row.category),
    confidenceScore: row.confidence_score,
    isDeveloping: row.is_developing !== 0,
    publishedAt: new Date(row.published_at),
    lastUpdatedAt: new Date(row.last_updated_at),
    versionHistorySummary: parse(row.version_history_summary),
    credibilitySummary: parse(row.credibility_summary),
  };
}

const publicFilter = `published_at >= ? AND EXISTS (
  SELECT 1 FROM json_each(story_read_model.version_history_summary) AS version
  WHERE json_extract(version.value, '$.prompt_version') = ?
    AND json_extract(version.value, '$.is_current') = 1
)`;

/** Public CQRS projection on D1. No PostgreSQL client or Hyperdrive binding. */
export class D1StoryReadModelRepository {
  constructor(private readonly db: D1Client) {}

  async getBySlug(slug: string): Promise<StoryReadModelRow | null> {
    const row = await this.db
      .prepare(
        `
      SELECT * FROM story_read_model WHERE slug = ? AND ${publicFilter} LIMIT 1
    `,
      )
      .bind(slug, d1Timestamp(new Date(TABLOID_PUBLIC_START)), TABLOID_PUBLIC_PROMPT)
      .first<ReadModelSqlRow>();
    return row ? hydrate(row) : null;
  }

  async listPublished(params: { limit: number; offset: number }): Promise<StoryReadModelRow[]> {
    const result = await this.db
      .prepare(
        `
      SELECT * FROM story_read_model WHERE ${publicFilter}
      ORDER BY published_at DESC, story_id DESC LIMIT ? OFFSET ?
    `,
      )
      .bind(
        d1Timestamp(new Date(TABLOID_PUBLIC_START)),
        TABLOID_PUBLIC_PROMPT,
        Math.max(0, params.limit),
        Math.max(0, params.offset),
      )
      .all<ReadModelSqlRow>();
    return result.results.map(hydrate);
  }

  async countPublished(): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS total FROM story_read_model WHERE ${publicFilter}`)
      .bind(d1Timestamp(new Date(TABLOID_PUBLIC_START)), TABLOID_PUBLIC_PROMPT)
      .first<{ total: number }>();
    return row?.total ?? 0;
  }

  async upsert(row: NewStoryReadModelRow): Promise<void> {
    await this.db
      .prepare(
        `
      INSERT INTO story_read_model (
        story_id, slug, title_hu, lead_hu, body_html, image_url,
        inline_images, is_ai_generated, meta_description, structured_data,
        sources_summary, tags, category, confidence_score, is_developing,
        published_at, last_updated_at, version_history_summary, credibility_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(story_id) DO UPDATE SET
        slug=excluded.slug, title_hu=excluded.title_hu, lead_hu=excluded.lead_hu,
        body_html=excluded.body_html, image_url=excluded.image_url,
        inline_images=excluded.inline_images, is_ai_generated=excluded.is_ai_generated,
        meta_description=excluded.meta_description, structured_data=excluded.structured_data,
        sources_summary=excluded.sources_summary, tags=excluded.tags,
        category=excluded.category, confidence_score=excluded.confidence_score,
        is_developing=excluded.is_developing, published_at=excluded.published_at,
        last_updated_at=excluded.last_updated_at,
        version_history_summary=excluded.version_history_summary,
        credibility_summary=excluded.credibility_summary
    `,
      )
      .bind(
        row.storyId,
        row.slug,
        row.titleHu,
        row.leadHu,
        row.bodyHtml,
        row.imageUrl ?? null,
        json(row.inlineImages ?? []),
        Number(row.isAiGenerated ?? true),
        row.metaDescription ?? null,
        row.structuredData == null ? null : json(row.structuredData),
        json(row.sourcesSummary ?? []),
        json(row.tags ?? []),
        row.category == null ? null : json(row.category),
        row.confidenceScore ?? null,
        Number(row.isDeveloping ?? false),
        d1Timestamp(row.publishedAt),
        d1Timestamp(row.lastUpdatedAt ?? new Date()),
        json(row.versionHistorySummary ?? []),
        row.credibilitySummary == null ? null : json(row.credibilitySummary),
      )
      .run();
  }

  async deleteByStoryId(storyId: string): Promise<void> {
    await this.db.prepare("DELETE FROM story_read_model WHERE story_id = ?").bind(storyId).run();
  }
}
