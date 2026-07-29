import { describe, expect, it } from "vitest";
import { RssSourceAdapter, type RssParserLike } from "./rss-adapter";

describe("RssSourceAdapter", () => {
  it("normalizes RSS items into NormalizedArticle, stripping HTML", async () => {
    const fakeParser: RssParserLike = {
      parseURL: async (url) => {
        expect(url).toBe("https://feeds.example.com/football.xml");
        return {
          items: [
            {
              link: "https://example.com/article-1",
              title: "Team <b>A</b> wins",
              contentSnippet: "<p>Great match &amp; result.</p>",
              isoDate: "2026-07-27T10:00:00.000Z",
            },
          ],
        };
      },
    };
    const adapter = new RssSourceAdapter(fakeParser);

    const articles = await adapter.fetch({ url: "https://feeds.example.com/football.xml" });

    expect(articles).toEqual([
      {
        sourceUrl: "https://example.com/article-1",
        titleOriginal: "Team A wins",
        subtitleOriginal: null,
        bodyOriginal: "Great match & result.",
        authorOriginal: null,
        publishedAtSource: new Date("2026-07-27T10:00:00.000Z"),
        imageUrl: null,
        contentOrigin: "rss_snippet",
      },
    ]);
  });

  it("prefers a native enclosure image over media:thumbnail", async () => {
    const fakeParser: RssParserLike = {
      parseURL: async () => ({
        items: [
          {
            link: "https://example.com/a",
            title: "A",
            enclosure: { url: "https://example.com/enclosure.jpg" },
            mediaThumbnail: { $: { url: "https://example.com/thumb.jpg" } },
          },
        ],
      }),
    };
    const adapter = new RssSourceAdapter(fakeParser);
    const [article] = await adapter.fetch({ url: "https://feeds.example.com/football.xml" });
    expect(article?.imageUrl).toBe("https://example.com/enclosure.jpg");
  });

  it("falls back to the first media:thumbnail when there is no enclosure, including array form", async () => {
    const fakeParser: RssParserLike = {
      parseURL: async () => ({
        items: [
          {
            link: "https://example.com/a",
            title: "A",
            mediaThumbnail: [
              { $: { url: "https://example.com/thumb-1.jpg" } },
              { $: { url: "https://example.com/thumb-2.jpg" } },
            ],
          },
        ],
      }),
    };
    const adapter = new RssSourceAdapter(fakeParser);
    const [article] = await adapter.fetch({ url: "https://feeds.example.com/football.xml" });
    expect(article?.imageUrl).toBe("https://example.com/thumb-1.jpg");
  });

  it("sets imageUrl to null when neither enclosure nor media:thumbnail is present", async () => {
    const fakeParser: RssParserLike = {
      parseURL: async () => ({ items: [{ link: "https://example.com/a", title: "A" }] }),
    };
    const adapter = new RssSourceAdapter(fakeParser);
    const [article] = await adapter.fetch({ url: "https://feeds.example.com/football.xml" });
    expect(article?.imageUrl).toBeNull();
  });

  it("drops items missing a link or a title", async () => {
    const fakeParser: RssParserLike = {
      parseURL: async () => ({
        items: [
          { title: "No link here" },
          { link: "https://example.com/no-title" },
          { link: "https://example.com/ok", title: "Fine" },
        ],
      }),
    };
    const adapter = new RssSourceAdapter(fakeParser);

    const articles = await adapter.fetch({ url: "https://feeds.example.com/football.xml" });

    expect(articles).toHaveLength(1);
    expect(articles[0]?.sourceUrl).toBe("https://example.com/ok");
  });

  it("sets publishedAtSource to null when no valid date is present", async () => {
    const fakeParser: RssParserLike = {
      parseURL: async () => ({
        items: [{ link: "https://example.com/a", title: "A", pubDate: "not-a-date" }],
      }),
    };
    const adapter = new RssSourceAdapter(fakeParser);

    const [article] = await adapter.fetch({ url: "https://feeds.example.com/football.xml" });

    expect(article?.publishedAtSource).toBeNull();
  });

  it("rejects a fetchConfig without a valid url", async () => {
    const adapter = new RssSourceAdapter({ parseURL: async () => ({ items: [] }) });
    await expect(adapter.fetch({})).rejects.toThrow();
  });
});
