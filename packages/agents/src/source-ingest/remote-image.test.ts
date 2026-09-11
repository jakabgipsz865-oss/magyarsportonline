import { describe, expect, it, vi } from "vitest";
import { fetchArticleImage, imageFromHtml, selectRemoteImage } from "./remote-image";

describe("remote image metadata only", () => {
  it("chooses declared large OG over a small image and keeps the exact signed URL", () => {
    const url = "https://cdn.publisher.test/photo.jpg?w=1600&sig=abc%2Fxyz";
    const html = `<meta property="og:image" content="https://cdn.publisher.test/small.jpg"><meta property="og:image:width" content="150"><meta property="og:image:height" content="84"><meta property="og:image" content="${url}"><meta property="og:image:width" content="1600"><meta property="og:image:height" content="900">`;
    expect(imageFromHtml(html, "https://publisher.test/story")).toEqual({
      url,
      width: 1600,
      height: 900,
      source: "og",
    });
  });
  it("rejects known tiny images even when twitter repeats the URL without dimensions", () => {
    expect(
      imageFromHtml(
        '<meta property="og:image" content="https://publisher.test/small.jpg"><meta property="og:image:width" content="300"><meta name="twitter:image" content="https://publisher.test/small.jpg">',
        "https://publisher.test/story",
      ),
    ).toBeNull();
  });
  it("reads article JSON-LD images with dimensions", () => {
    expect(
      imageFromHtml(
        '<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","image":{"url":"https://cdn.publisher.test/large.jpg","width":1920,"height":1080}}]}</script>',
        "https://publisher.test/story",
      ),
    ).toMatchObject({ source: "json-ld", width: 1920, height: 1080 });
  });
  it("does not extract paywalled metadata", () => {
    expect(
      imageFromHtml(
        '<meta property="og:image" content="https://publisher.test/large.jpg"><script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>',
        "https://publisher.test/story",
      ),
    ).toBeNull();
  });
  it("makes exactly one HTML request and never fetches the image URL", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        '<meta property="og:image" content="https://cdn.publisher.test/large.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="675">',
        {
          headers: { "Content-Type": "text/html" },
        },
      ),
    );
    expect(
      await fetchArticleImage(
        "https://publisher.test/story",
        "https://publisher.test/feed",
        fetcher,
      ),
    ).toMatchObject({ url: "https://cdn.publisher.test/large.jpg" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://publisher.test/story");
  });
  it.each([403, 302])("does not bypass HTTP %s", async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("", { status, headers: { Location: "https://publisher.test/login" } }),
      );
    expect(
      await fetchArticleImage(
        "https://publisher.test/story",
        "https://publisher.test/feed",
        fetcher,
      ),
    ).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not read binary responses or fetch an unrelated/internal URL", async () => {
    const binary = new Response("binary", { headers: { "Content-Type": "image/jpeg" } });
    const text = vi.spyOn(binary, "text");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(binary);
    expect(
      await fetchArticleImage("https://publisher.test/a", "https://publisher.test/feed", fetcher),
    ).toBeNull();
    expect(text).not.toHaveBeenCalled();
    fetcher.mockClear();
    expect(
      await fetchArticleImage("http://127.0.0.1/a", "https://publisher.test/feed", fetcher),
    ).toBeNull();
    expect(
      await fetchArticleImage("https://other.test/a", "https://publisher.test/feed", fetcher),
    ).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("strict declared-width publisher image selection", () => {
  it("allows unknown article OG as fallback, without guessing dimensions from a density srcset", () => {
    expect(
      imageFromHtml(
        '<meta property="og:image" content="https://cdn.test/unknown.jpg"><article><img srcset="https://cdn.test/large.jpg 2x"></article>',
        "https://publisher.test/a",
      ),
    ).toMatchObject({
      url: "https://cdn.test/unknown.jpg",
      width: null,
      height: null,
      source: "og",
    });
  });
  it("selects the largest publisher-declared srcset URL unchanged over OG", () => {
    const url = "https://cdn.test/photo.jpg?w=1920&token=a%2Fb";
    expect(
      imageFromHtml(
        `<meta property="og:image" content="https://cdn.test/og.jpg"><meta property="og:image:width" content="1200"><article><img srcset="https://cdn.test/a.jpg 300w, ${url} 1920w, https://cdn.test/b.jpg 800w"></article>`,
        "https://publisher.test/a",
      ),
    ).toEqual({ url, source: "srcset", width: 1920, height: null });
  });
  it("reads data-srcset 800px fallback and ignores unrelated navigation pictures", () => {
    expect(
      imageFromHtml(
        '<nav><img srcset="https://cdn.test/nav.jpg 3000w"></nav><article><img data-srcset="https://cdn.test/a.jpg 150w, https://cdn.test/b.jpg 800w"></article>',
        "https://publisher.test/a",
      ),
    ).toMatchObject({ url: "https://cdn.test/b.jpg", source: "data-srcset", width: 800 });
  });
  it("reads standalone JSON-LD ImageObject and Twitter dimensions", () => {
    expect(
      imageFromHtml(
        '<script type="application/ld+json">{"@type":"ImageObject","contentUrl":"https://cdn.test/object.jpg","width":1600,"height":900}</script><meta name="twitter:image" content="https://cdn.test/twitter.jpg"><meta name="twitter:image:width" content="1200"><meta name="twitter:image:height" content="675">',
        "https://publisher.test/a",
      ),
    ).toMatchObject({ source: "json-ld", width: 1600, height: 900 });
  });
  it("returns null for only tiny srcsets", () => {
    expect(
      imageFromHtml(
        '<article><img srcset="https://cdn.test/a.jpg 150w, https://cdn.test/b.jpg 300w"></article>',
        "https://publisher.test/a",
      ),
    ).toBeNull();
  });
});

describe("safe unknown-size article fallback", () => {
  it.each([
    ['<meta property="og:image" content="https://cdn.test/large.jpg?sig=a%2Fb">', "og"],
    [
      '<script type="application/ld+json">{"@type":"NewsArticle","image":"https://cdn.test/large.jpg?sig=a%2Fb"}</script>',
      "json-ld",
    ],
    ['<meta name="twitter:image" content="https://cdn.test/large.jpg?sig=a%2Fb">', "twitter"],
  ])("keeps publisher URL unchanged with unknown dimensions: %s", (html, source) => {
    expect(imageFromHtml(html, "https://publisher.test/article")).toEqual({
      url: "https://cdn.test/large.jpg?sig=a%2Fb",
      source,
      width: null,
      height: null,
    });
  });
  it("never resurrects known tiny RSS URL through an unknown OG fallback", () => {
    const url = "https://cdn.test/small.jpg";
    expect(
      selectRemoteImage([
        { url, source: "enclosure", width: 150, height: 84 },
        { url, source: "og", width: null, height: null },
      ]),
    ).toBeNull();
  });
  it("prefers known 800px over unknown OG and OG over other unknown metadata", () => {
    const og = { url: "https://cdn.test/og.jpg", source: "og" as const, width: null, height: null };
    const json = {
      url: "https://cdn.test/json.jpg",
      source: "json-ld" as const,
      width: null,
      height: null,
    };
    const twitter = {
      url: "https://cdn.test/twitter.jpg",
      source: "twitter" as const,
      width: null,
      height: null,
    };
    const rss = {
      url: "https://cdn.test/rss.jpg",
      source: "media:content" as const,
      width: 800,
      height: 450,
    };
    expect(selectRemoteImage([json, twitter, og])).toEqual(og);
    expect(selectRemoteImage([og, json, rss])).toEqual(rss);
  });
});

it("follows only a same-article permanent trailing-slash redirect, with HTML requests only", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("", { status: 308, headers: { Location: "/article" } }))
    .mockResolvedValueOnce(
      new Response('<meta property="og:image" content="https://cdn.test/article.jpg">', {
        headers: { "Content-Type": "text/html" },
      }),
    );
  expect(
    await fetchArticleImage(
      "https://publisher.test/article/",
      "https://publisher.test/feed",
      fetcher,
    ),
  ).toMatchObject({ url: "https://cdn.test/article.jpg", width: null, source: "og" });
  expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
    "https://publisher.test/article/",
    "https://publisher.test/article",
  ]);
});
it("does not follow permanent redirects to login or another article", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("", { status: 301, headers: { Location: "/login" } }));
  expect(
    await fetchArticleImage(
      "https://publisher.test/article/",
      "https://publisher.test/feed",
      fetcher,
    ),
  ).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("allows an article on a publisher subdomain but not a lookalike host", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response('<meta name="twitter:image" content="https://cdn.test/article.jpg">', {
      headers: { "Content-Type": "text/html" },
    }),
  );
  expect(
    await fetchArticleImage(
      "https://video.publisher.test/article",
      "https://www.publisher.test/feed",
      fetcher,
    ),
  ).toMatchObject({ source: "twitter" });
  expect(
    await fetchArticleImage(
      "https://publisher.test.evil.test/article",
      "https://www.publisher.test/feed",
      fetcher,
    ),
  ).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
