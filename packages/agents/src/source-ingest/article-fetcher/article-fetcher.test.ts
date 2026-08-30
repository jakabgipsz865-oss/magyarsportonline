import { describe, expect, it, vi } from "vitest";
import { ArticleFetcher } from "./article-fetcher";
import type { ArticleExtractor, HtmlFetcher } from "./types";

function fakeExtractor(overrides: Partial<ArticleExtractor> = {}): ArticleExtractor {
  return {
    name: "fake",
    supports: () => true,
    extract: () => ({
      titleOriginal: "T",
      subtitleOriginal: null,
      bodyOriginal: "B",
      authorOriginal: null,
      publishedAtSource: null,
    }),
    ...overrides,
  };
}

describe("ArticleFetcher", () => {
  it("returns null when no extractor supports the URL's domain", async () => {
    const htmlFetcher: HtmlFetcher = { fetch: vi.fn(async () => "<html></html>") };
    const fetcher = new ArticleFetcher(htmlFetcher, [fakeExtractor({ supports: () => false })]);

    const result = await fetcher.fetch("https://unsupported.example.com/1");

    expect(result).toBeNull();
    expect(htmlFetcher.fetch).not.toHaveBeenCalled();
  });

  it("downloads the HTML and returns the extractor's result when supported", async () => {
    const htmlFetcher: HtmlFetcher = { fetch: vi.fn(async () => "<html>real page</html>") };
    const extractor = fakeExtractor();
    const fetcher = new ArticleFetcher(htmlFetcher, [extractor]);

    const result = await fetcher.fetch("https://example.com/article-1");

    expect(result).toEqual({
      titleOriginal: "T",
      subtitleOriginal: null,
      bodyOriginal: "B",
      authorOriginal: null,
      publishedAtSource: null,
    });
  });

  it("returns null when the extractor cannot find the expected structure", async () => {
    const htmlFetcher: HtmlFetcher = { fetch: vi.fn(async () => "<html>unexpected</html>") };
    const fetcher = new ArticleFetcher(htmlFetcher, [fakeExtractor({ extract: () => null })]);

    const result = await fetcher.fetch("https://example.com/article-1");

    expect(result).toBeNull();
  });

  it("returns null (never throws) when the HTML download fails, after retrying once", async () => {
    const fetchCalls: number[] = [];
    const htmlFetcher: HtmlFetcher = {
      fetch: vi.fn(async () => {
        fetchCalls.push(Date.now());
        throw new Error("network down");
      }),
    };
    const fetcher = new ArticleFetcher(htmlFetcher, [fakeExtractor()]);

    const result = await fetcher.fetch("https://example.com/article-1");

    expect(result).toBeNull();
    expect(htmlFetcher.fetch).toHaveBeenCalledTimes(2); // 1 retry
  });

  it("picks the first extractor whose supports() returns true", async () => {
    const htmlFetcher: HtmlFetcher = { fetch: vi.fn(async () => "<html></html>") };
    const notCalled = fakeExtractor({ name: "not-called", supports: () => false });
    const called = fakeExtractor({ name: "called", supports: () => true });
    const fetcher = new ArticleFetcher(htmlFetcher, [notCalled, called]);

    const result = await fetcher.fetch("https://example.com/1");

    expect(result?.titleOriginal).toBe("T");
  });
  it("fetches and attributes a uniquely resolved text report", async () => {
    const videoUrl = "https://www.bbc.com/sport/football/videos/cx2zvzpdyjdo";
    const reportUrl = "https://www.bbc.com/sport/football/live/cmq8jxqj2vpet";
    const htmlFetcher: HtmlFetcher = {
      fetch: vi.fn(async (url) =>
        url === videoUrl ? "<html>video</html>" : "<html>report</html>",
      ),
    };
    const extractor = fakeExtractor({
      resolveUrl: () => reportUrl,
      extract: (_html, url) => ({
        titleOriginal: url === reportUrl ? "Match report" : "Video",
        subtitleOriginal: null,
        bodyOriginal: "Full match report body.",
        authorOriginal: null,
        publishedAtSource: null,
      }),
    });
    const fetcher = new ArticleFetcher(htmlFetcher, [extractor]);

    const result = await fetcher.fetch(videoUrl);

    expect(htmlFetcher.fetch).toHaveBeenCalledTimes(2);
    expect(result?.titleOriginal).toBe("Match report");
    expect(result?.resolvedUrl).toBe(reportUrl);
  });
});
