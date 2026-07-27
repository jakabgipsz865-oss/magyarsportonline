export interface NormalizedArticle {
  sourceUrl: string;
  titleOriginal: string;
  bodyOriginal: string;
  publishedAtSource: Date | null;
}

/**
 * One implementation per `Source.type` (docs/architecture/01-data-model.md
 * §1.2: `"rss" | "api" | "scraper"`). New source types plug in here without
 * touching the Source Ingest Agent's orchestration logic (index.ts) — per
 * the user's explicit MVP requirement that adding a source is a
 * configuration change, not a code change to the ingest pipeline.
 */
export interface SourceAdapter {
  fetch(fetchConfig: unknown): Promise<NormalizedArticle[]>;
}
