import { describe, expect, it } from "vitest";
import { ARTICLE_EXTRACTORS } from "./index";
import { STRUCTURED_NEWS_DOMAINS, structuredNewsArticleExtractor } from "./structured-news-article";

const ARTICLE_BODY = `Liverpool completed a dramatic league victory after recovering from an early setback at Anfield. The hosts controlled possession before scoring twice in the second half, while the visiting side continued to threaten on the counterattack. The winning goal arrived late in the match and sent the home supporters into celebration. The result moved Liverpool higher in the table and extended their unbeaten run in domestic competition.`;

function jsonLdHtml(value: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(value)}</script></head></html>`;
}

describe("structuredNewsArticleExtractor.supports", () => {
  it("supports only the explicit domain allowlist and its subdomains", () => {
    for (const domain of STRUCTURED_NEWS_DOMAINS) {
      expect(structuredNewsArticleExtractor.supports(`https://${domain}/sport/story`)).toBe(true);
      expect(structuredNewsArticleExtractor.supports(`https://www.${domain}/sport/story`)).toBe(
        true,
      );
    }
    expect(structuredNewsArticleExtractor.supports("https://talksport.com.evil.example/x")).toBe(
      false,
    );
    expect(structuredNewsArticleExtractor.supports("https://example.com/x")).toBe(false);
    expect(structuredNewsArticleExtractor.supports("not-a-url")).toBe(false);
  });

  it("is registered exactly once", () => {
    expect(
      ARTICLE_EXTRACTORS.filter((extractor) => extractor.name === "structured-news-article"),
    ).toEqual([structuredNewsArticleExtractor]);
  });
});

describe("structuredNewsArticleExtractor.extract", () => {
  it("extracts an Article from an @graph and cleans its structured fields", () => {
    const html = jsonLdHtml({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Football site" },
        {
          "@type": ["Thing", "NewsArticle"],
          headline: " Liverpool complete dramatic comeback win ",
          articleBody: `<p>${ARTICLE_BODY}</p>`,
          datePublished: "2026-08-29T10:30:00.000Z",
          author: [{ "@type": "Person", name: "Alex Reporter" }, "News Desk"],
        },
      ],
    });

    const result = structuredNewsArticleExtractor.extract(
      html,
      "https://www.talksport.com/football/story",
    );

    expect(result).toEqual({
      titleOriginal: "Liverpool complete dramatic comeback win",
      subtitleOriginal: null,
      bodyOriginal: ARTICLE_BODY,
      authorOriginal: "Alex Reporter, News Desk",
      publishedAtSource: new Date("2026-08-29T10:30:00.000Z"),
    });
  });

  it("returns null for malformed, missing, or too-short article data", () => {
    const malformed = `<script type="application/ld+json">{broken</script>`;
    expect(
      structuredNewsArticleExtractor.extract(malformed, "https://goal.com/football/story"),
    ).toBeNull();
    expect(
      structuredNewsArticleExtractor.extract(
        jsonLdHtml({ "@type": "NewsArticle", headline: "A valid headline", articleBody: "Short" }),
        "https://goal.com/football/story",
      ),
    ).toBeNull();
  });

  it("falls back to the longest semantic article body when JSON-LD has no articleBody", () => {
    const html = `<html><head><meta property="og:title" content="Michael Carrick lays out the Manchester United transfer plan"><script type="application/ld+json">${JSON.stringify(
      { "@type": "NewsArticle", headline: "Headline", articleBody: "" },
    )}</script></head><body><article><p>Related card only.</p></article><article><h1>Michael Carrick lays out the Manchester United transfer plan</h1><p>${ARTICLE_BODY}</p><p>${ARTICLE_BODY} Additional confirmed context from the same report.</p></article></body></html>`;
    const result = structuredNewsArticleExtractor.extract(
      html,
      "https://www.express.co.uk/sport/football/2243932/man-utd-transfer-news-carrick",
    );
    expect(result?.titleOriginal).toContain("Michael Carrick");
    expect(result?.bodyOriginal.length).toBeGreaterThan(700);
  });

  it("does not extract valid-looking JSON-LD from a non-allowlisted domain", () => {
    const html = jsonLdHtml({
      "@type": "NewsArticle",
      headline: "Liverpool complete dramatic comeback win",
      articleBody: ARTICLE_BODY,
    });
    expect(structuredNewsArticleExtractor.extract(html, "https://example.com/story")).toBeNull();
  });
});
