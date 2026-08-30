import type { Logger } from "@magyarsportonline/observability";
import { withRetry } from "../../shared/retry";
import { ARTICLE_EXTRACTORS } from "./extractors/index";
import type { ArticleExtractor, FetchedArticle, HtmlFetcher } from "./types";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; MagyarSportOnlineBot/1.0; +https://magyarsportonline.hu)";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Valódi HTTP-letöltés natív `fetch`-csel, időkorláttal és azonosító
 * User-Agenttel. Sosem próbál bot-védelmet/CAPTCHA-t megkerülni — ha egy
 * forrás blokkol, az egyszerűen hibaként landol, és a hívó (ArticleFetcher)
 * biztonságosan az RSS-fallback-ra vált, nem próbálkozik agresszívan újra.
 */
export class HttpHtmlFetcher implements HtmlFetcher {
  async fetch(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": DEFAULT_USER_AGENT, Accept: "text/html" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${url}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * "Source Fetcher" réteg (2026-07-28-i sprint, pipeline: RSS -> Source
 * Fetcher -> HTML letöltés -> Main article extraction -> Tisztítás ->
 * Fact Verification). SOHA nem dob hibát kifelé: bármilyen hiba (nincs
 * regisztrált extractor a domainhez, hálózati hiba, ismeretlen HTML-
 * szerkezet) `null`-t eredményez, amit a hívó (ArticleEnrichingSourceAdapter,
 * lásd ../article-enriching-adapter.ts) az eredeti RSS-snippet
 * megtartásával kezel — a pipeline emiatt sosem állhat le.
 */
export class ArticleFetcher {
  constructor(
    private readonly htmlFetcher: HtmlFetcher = new HttpHtmlFetcher(),
    private readonly extractors: ArticleExtractor[] = ARTICLE_EXTRACTORS,
    private readonly logger?: Logger,
  ) {}

  async fetch(url: string): Promise<FetchedArticle | null> {
    const extractor = this.extractors.find((candidate) => candidate.supports(url));
    if (!extractor) {
      return null;
    }

    try {
      const html = await withRetry(() => this.htmlFetcher.fetch(url), { retries: 1 });
      const resolvedUrl = extractor.resolveUrl?.(html, url);
      if (resolvedUrl && resolvedUrl !== url) {
        try {
          const resolvedHtml = await withRetry(() => this.htmlFetcher.fetch(resolvedUrl), {
            retries: 1,
          });
          const resolvedResult = extractor.extract(resolvedHtml, resolvedUrl);
          if (resolvedResult) {
            return { ...resolvedResult, resolvedUrl };
          }
        } catch (error) {
          this.logger?.warn(
            {
              url,
              resolvedUrl,
              extractor: extractor.name,
              error: error instanceof Error ? error.message : String(error),
            },
            "resolved article fetch failed, falling back to the original page",
          );
        }
      }
      const result = extractor.extract(html, url);
      if (!result) {
        this.logger?.warn(
          { url, extractor: extractor.name },
          "article extractor found no matching structure, falling back to RSS snippet",
        );
      }
      return result;
    } catch (error) {
      this.logger?.warn(
        {
          url,
          extractor: extractor.name,
          error: error instanceof Error ? error.message : String(error),
        },
        "full article fetch failed, falling back to RSS snippet",
      );
      return null;
    }
  }
}
