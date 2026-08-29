import type { ArticleExtractor } from "../types";
import { bbcSportExtractor } from "./bbc-sport";
import { skySportsExtractor } from "./sky-sports";
import { structuredNewsArticleExtractor } from "./structured-news-article";

/**
 * Zárt extractor registry. A structured extractor is csak a saját explicit
 * domain-allowlistjén fut; minden más domain változatlanul RSS fallbackre esik.
 */
export const ARTICLE_EXTRACTORS: ArticleExtractor[] = [
  bbcSportExtractor,
  skySportsExtractor,
  structuredNewsArticleExtractor,
];

export { bbcSportExtractor, skySportsExtractor, structuredNewsArticleExtractor };
