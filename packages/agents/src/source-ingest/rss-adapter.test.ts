import { describe, expect, it } from "vitest";
import { RssSourceAdapter, createDefaultParser, type RssParserLike } from "./rss-adapter";

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

  it("does not trust dimensionless enclosure or thumbnail quality", async () => {
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
    expect(article?.imageUrl).toBeNull();
  });

  it("uses a placeholder for dimensionless RSS thumbnails", async () => {
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
    expect(article?.imageUrl).toBeNull();
  });

  it.each([
    [
      {
        enclosure: {
          url: "https://publisher.test/small.jpg",
          width: "150",
          height: "84",
          type: "image/jpeg",
        },
        mediaContent: [
          {
            $: {
              url: "https://publisher.test/large.jpg?width=1200&signature=abc",
              width: "1200",
              height: "675",
              type: "image/jpeg",
            },
          },
        ],
      },
      "https://publisher.test/large.jpg?width=1200&signature=abc",
    ],
    [
      {
        mediaThumbnail: [
          { $: { url: "https://publisher.test/300.jpg", width: "300", height: "169" } },
          { $: { url: "https://publisher.test/1024.jpg", width: "1024", height: "576" } },
        ],
      },
      "https://publisher.test/1024.jpg",
    ],
    [
      {
        enclosure: { url: "https://publisher.test/tiny.jpg", width: "150", height: "84" },
        mediaThumbnail: [
          { $: { url: "https://publisher.test/300.jpg", width: "300", height: "169" } },
        ],
      },
      null,
    ],
    [
      {
        mediaContent: [
          {
            $: {
              url: "https://publisher.test/video.mp4",
              width: "1920",
              height: "1080",
              type: "video/mp4",
            },
          },
        ],
      },
      null,
    ],
  ])(
    "selects declared large publisher images and preserves their exact URL",
    async (images, expected) => {
      const adapter = new RssSourceAdapter({
        parseURL: async () => ({
          items: [{ link: "https://publisher.test/article", title: "Football", ...images }],
        }),
      });
      const [article] = await adapter.fetch({ url: "https://publisher.test/rss" });
      expect(article?.imageUrl).toBe(expected);
      if (expected) expect(article?.image?.url).toBe(expected);
    },
  );
  it("keeps every media content/thumbnail element when parsing real XML", async () => {
    const parser = createDefaultParser() as ReturnType<typeof createDefaultParser> & {
      parseString(xml: string): ReturnType<RssParserLike["parseURL"]>;
    };
    const feed = await parser.parseString(
      `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Football</title><item><title>Football</title><link>https://publisher.test/a</link><enclosure url="https://publisher.test/tiny.jpg" type="image/jpeg" width="150" height="84"/><media:content url="https://publisher.test/800.jpg" type="image/jpeg" width="800" height="450"/><media:content url="https://publisher.test/1200.jpg" type="image/jpeg" width="1200" height="675"/><media:thumbnail url="https://publisher.test/300.jpg" width="300" height="169"/><media:thumbnail url="https://publisher.test/1024.jpg" width="1024" height="576"/></item></channel></rss>`,
    );
    const adapter = new RssSourceAdapter({ parseURL: async () => feed });
    const [article] = await adapter.fetch({ url: "https://publisher.test/feed" });
    expect(article?.imageUrl).toBe("https://publisher.test/1200.jpg");
    expect(article?.image?.source).toBe("media:content");
  });
  it("parses publisher CEST dates", async () => {
    const adapter = new RssSourceAdapter({
      parseURL: async () => ({
        items: [
          {
            link: "https://publisher.test/a",
            title: "Football",
            pubDate: "Thu, 10 Sep 2026 23:00:53 CEST",
          },
        ],
      }),
    });
    expect(
      (
        await adapter.fetch({ url: "https://publisher.test/feed" })
      )[0]?.publishedAtSource?.toISOString(),
    ).toBe("2026-09-10T21:00:53.000Z");
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

  it("parses Sky's live RSS pubDate with a BST timezone", async () => {
    const adapter = new RssSourceAdapter({
      parseURL: async () => ({
        items: [
          {
            link: "https://www.skysports.com/football/news/example",
            title: "Sky live-format fixture",
            pubDate: "Sun, 30 Aug 2026 17:15:00 BST",
          },
        ],
      }),
    });

    const [article] = await adapter.fetch({ url: "https://www.skysports.com/rss/12040" });

    expect(article?.publishedAtSource).toEqual(new Date("2026-08-30T16:15:00.000Z"));
  });

  it("rejects a fetchConfig without a valid url", async () => {
    const adapter = new RssSourceAdapter({ parseURL: async () => ({ items: [] }) });
    await expect(adapter.fetch({})).rejects.toThrow();
  });
  it("selects the largest remote media:thumbnail when dimensions are available", async () => {
    const adapter = new RssSourceAdapter({
      parseURL: async () => ({
        items: [
          {
            link: "https://example.com/a",
            title: "A",
            mediaThumbnail: [
              {
                $: {
                  url: "https://cdn.example.com/160.jpg",
                  width: "160",
                  height: "90",
                },
              },
              {
                $: {
                  url: "https://cdn.example.com/1280.jpg",
                  width: "1280",
                  height: "720",
                },
              },
              {
                $: {
                  url: "https://cdn.example.com/640.jpg",
                  width: "640",
                  height: "360",
                },
              },
            ],
          },
        ],
      }),
    });

    const [article] = await adapter.fetch({ url: "https://feeds.example.com/football.xml" });

    expect(article?.imageUrl).toBe("https://cdn.example.com/1280.jpg");
  });
});
