import type { Logger } from "@magyarsportonline/observability";
import { ArticleFetcher } from "./article-fetcher/article-fetcher";
import type { NormalizedArticle, SourceAdapter } from "./types";

/**
 * Dekorátor bármelyik `SourceAdapter` köré (pipeline: RSS -> Source
 * Fetcher, 2026-07-28-i sprint): az RSS-ből kapott rövid
 * `contentSnippet`-et lecseréli a cikkoldalról letöltött és tisztított
 * teljes törzsre, HA van a domainhez regisztrált extractor és a
 * letöltés/kinyerés sikerül. Bármilyen hiba esetén (nincs extractor a
 * domainhez, hálózati hiba, ismeretlen HTML-szerkezet) az eredeti,
 * RSS-alapú `NormalizedArticle`-t adja tovább változatlanul — a pipeline
 * emiatt sosem állhat le.
 */
export class ArticleEnrichingSourceAdapter implements SourceAdapter {
  constructor(
    private readonly inner: SourceAdapter,
    private readonly articleFetcher: ArticleFetcher = new ArticleFetcher(),
    private readonly logger?: Logger,
  ) {}

  async fetch(fetchConfig: unknown): Promise<NormalizedArticle[]> {
    const articles = await this.inner.fetch(fetchConfig);
    return Promise.all(articles.map((article) => this.enrich(article)));
  }

  private async enrich(article: NormalizedArticle): Promise<NormalizedArticle> {
    const fetched = await this.articleFetcher.fetch(article.sourceUrl);
    if (!fetched) {
      return article;
    }
    this.logger?.info(
      { sourceUrl: article.sourceUrl, bodyLength: fetched.bodyOriginal.length },
      "enriched article with full source-fetched body",
    );
    return {
      ...article,
      sourceUrl: fetched.resolvedUrl ?? article.sourceUrl,
      titleOriginal: fetched.titleOriginal || article.titleOriginal,
      subtitleOriginal: fetched.subtitleOriginal,
      bodyOriginal: fetched.bodyOriginal,
      authorOriginal: fetched.authorOriginal,
      publishedAtSource: fetched.publishedAtSource ?? article.publishedAtSource,
      contentOrigin: "full_article",
    };
  }
}
