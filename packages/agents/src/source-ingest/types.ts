export interface NormalizedArticle {
  sourceUrl: string;
  titleOriginal: string;
  /** Alcím/standfirst, ha a forrás megadja — az RSS-adapter mindig `null`-t ad, a Source Fetcher (article-fetcher/) tölti ki, ha talál ilyet. */
  subtitleOriginal: string | null;
  bodyOriginal: string;
  /** Szerző neve, ha a forrás megadja — sok sporthír-oldal (pl. BBC Sport) ezt nem közli, ilyenkor `null`. */
  authorOriginal: string | null;
  publishedAtSource: Date | null;
  /** RSS media:thumbnail/enclosure image URL, if the feed item provided one. */
  imageUrl: string | null;
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
