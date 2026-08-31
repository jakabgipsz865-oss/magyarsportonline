import { describe, expect, it, vi } from "vitest";
import { ArticleEnrichingSourceAdapter } from "./article-enriching-adapter";
import type { ArticleFetcher } from "./article-fetcher/article-fetcher";
import type { FetchedArticle } from "./article-fetcher/types";
import type { NormalizedArticle, SourceAdapter } from "./types";

const RSS_ARTICLE: NormalizedArticle = {
  sourceUrl: "https://www.bbc.co.uk/sport/football/1",
  titleOriginal: "RSS title",
  subtitleOriginal: null,
  bodyOriginal: "Short RSS snippet.",
  authorOriginal: null,
  publishedAtSource: null,
  imageUrl: null,
  contentOrigin: "rss_snippet",
};

function fakeInnerAdapter(articles: NormalizedArticle[] = [RSS_ARTICLE]): SourceAdapter {
  return { fetch: async () => articles };
}

function fakeArticleFetcher(result: FetchedArticle | null): ArticleFetcher {
  return { fetch: vi.fn(async () => result) } as unknown as ArticleFetcher;
}

describe("ArticleEnrichingSourceAdapter", () => {
  it("replaces the RSS snippet with the full fetched article when the fetch succeeds", async () => {
    const fetched: FetchedArticle = {
      titleOriginal: "Full title",
      subtitleOriginal: "A subtitle",
      bodyOriginal: "A much longer, full article body across several paragraphs.",
      authorOriginal: "Jane Reporter",
      publishedAtSource: new Date("2026-07-28T12:00:00.000Z"),
    };
    const adapter = new ArticleEnrichingSourceAdapter(
      fakeInnerAdapter(),
      fakeArticleFetcher(fetched),
    );

    const [result] = await adapter.fetch({});

    expect(result).toEqual({
      sourceUrl: RSS_ARTICLE.sourceUrl,
      titleOriginal: "Full title",
      subtitleOriginal: "A subtitle",
      bodyOriginal: "A much longer, full article body across several paragraphs.",
      authorOriginal: "Jane Reporter",
      publishedAtSource: new Date("2026-07-28T12:00:00.000Z"),
      imageUrl: null,
      contentOrigin: "full_article",
    });
  });

  it("falls back to the original RSS article unchanged when the fetch returns null", async () => {
    const adapter = new ArticleEnrichingSourceAdapter(fakeInnerAdapter(), fakeArticleFetcher(null));

    const [result] = await adapter.fetch({});

    expect(result).toEqual(RSS_ARTICLE);
  });

  it("keeps the RSS publishedAtSource when the fetched article has none", async () => {
    const rssWithDate: NormalizedArticle = {
      ...RSS_ARTICLE,
      publishedAtSource: new Date("2026-07-01T00:00:00.000Z"),
    };
    const fetched: FetchedArticle = {
      titleOriginal: "Full title",
      subtitleOriginal: null,
      bodyOriginal: "Full body.",
      authorOriginal: null,
      publishedAtSource: null,
    };
    const adapter = new ArticleEnrichingSourceAdapter(
      fakeInnerAdapter([rssWithDate]),
      fakeArticleFetcher(fetched),
    );

    const [result] = await adapter.fetch({});

    expect(result?.publishedAtSource).toEqual(new Date("2026-07-01T00:00:00.000Z"));
  });

  it("enriches every article returned by the inner adapter independently", async () => {
    const second: NormalizedArticle = {
      ...RSS_ARTICLE,
      sourceUrl: "https://www.bbc.co.uk/sport/2",
    };
    const fetcher = {
      fetch: vi.fn(async (url: string) =>
        url.endsWith("/1")
          ? {
              titleOriginal: "Enriched 1",
              subtitleOriginal: null,
              bodyOriginal: "Body 1",
              authorOriginal: null,
              publishedAtSource: null,
            }
          : null,
      ),
    } as unknown as ArticleFetcher;
    const adapter = new ArticleEnrichingSourceAdapter(
      fakeInnerAdapter([RSS_ARTICLE, second]),
      fetcher,
    );

    const results = await adapter.fetch({});

    expect(results[0]?.titleOriginal).toBe("Enriched 1");
    expect(results[1]).toEqual(second);
  });
  it("uses the resolved report URL as the public source link", async () => {
    const reportUrl = "https://www.bbc.com/sport/football/live/cmq8jxqj2vpet";
    const adapter = new ArticleEnrichingSourceAdapter(
      fakeInnerAdapter([
        {
          ...RSS_ARTICLE,
          sourceUrl: "https://www.bbc.com/sport/football/videos/cx2zvzpdyjdo",
        },
      ]),
      fakeArticleFetcher({
        titleOriginal: "Match report",
        subtitleOriginal: null,
        bodyOriginal: "Full match report body.",
        authorOriginal: null,
        publishedAtSource: null,
        resolvedUrl: reportUrl,
      }),
    );

    const [result] = await adapter.fetch({});

    expect(result?.sourceUrl).toBe(reportUrl);
    expect(result?.detectedSourceUrl).toBe(
      "https://www.bbc.com/sport/football/videos/cx2zvzpdyjdo",
    );
    expect(result?.contentOrigin).toBe("full_article");
  });
});
